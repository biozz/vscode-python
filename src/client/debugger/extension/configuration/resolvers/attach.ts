// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.

'use strict';

import { inject, injectable } from 'inversify';
import { CancellationToken, Uri, WorkspaceFolder } from 'vscode';
import { IDocumentManager, IWorkspaceService } from '../../../../common/application/types';
import { IPlatformService } from '../../../../common/platform/types';
import { IConfigurationService } from '../../../../common/types';
import { SystemVariables } from '../../../../common/variables/systemVariables';
import { AttachRequestArguments, DebugOptions } from '../../../types';
import { BaseConfigurationResolver } from './base';

@injectable()
export class AttachConfigurationResolver extends BaseConfigurationResolver<AttachRequestArguments> {
    constructor(@inject(IWorkspaceService) workspaceService: IWorkspaceService,
        @inject(IDocumentManager) documentManager: IDocumentManager,
        @inject(IPlatformService) private readonly platformService: IPlatformService,
        @inject(IConfigurationService) configurationService: IConfigurationService) {
        super(workspaceService, documentManager, configurationService);
    }
    public async resolveDebugConfiguration(folder: WorkspaceFolder | undefined, debugConfiguration: AttachRequestArguments, _token?: CancellationToken): Promise<AttachRequestArguments | undefined> {
        const workspaceFolder = this.getWorkspaceFolder(folder);

        await this.provideAttachDefaults(workspaceFolder, debugConfiguration as AttachRequestArguments);

        const dbgConfig = debugConfiguration;
        if (Array.isArray(dbgConfig.debugOptions)) {
            dbgConfig.debugOptions = dbgConfig.debugOptions!.filter((item, pos) => dbgConfig.debugOptions!.indexOf(item) === pos);
        }
        return debugConfiguration;
    }
    // tslint:disable-next-line:cyclomatic-complexity
    protected async provideAttachDefaults(workspaceFolder: Uri | undefined, debugConfiguration: AttachRequestArguments): Promise<void> {
        if (!Array.isArray(debugConfiguration.debugOptions)) {
            debugConfiguration.debugOptions = [];
        }
        if (!debugConfiguration.host) {
            debugConfiguration.host = 'localhost';
        }
        if (debugConfiguration.justMyCode === undefined) {
            // Populate justMyCode using debugStdLib
            debugConfiguration.justMyCode = !debugConfiguration.debugStdLib;
        }
        debugConfiguration.showReturnValue = debugConfiguration.showReturnValue !== false;
        // Pass workspace folder so we can get this when we get debug events firing.
        debugConfiguration.workspaceFolder = workspaceFolder ? workspaceFolder.fsPath : undefined;
        const debugOptions = debugConfiguration.debugOptions!;
        if (!debugConfiguration.justMyCode) {
            this.debugOption(debugOptions, DebugOptions.DebugStdLib);
        }
        if (debugConfiguration.django) {
            this.debugOption(debugOptions, DebugOptions.Django);
        }
        if (debugConfiguration.jinja) {
            this.debugOption(debugOptions, DebugOptions.Jinja);
        }
        if (debugConfiguration.subProcess === true) {
            this.debugOption(debugOptions, DebugOptions.SubProcess);
        }
        if (debugConfiguration.pyramid
            && debugOptions.indexOf(DebugOptions.Jinja) === -1
            && debugConfiguration.jinja !== false) {
            this.debugOption(debugOptions, DebugOptions.Jinja);
        }
        if (debugConfiguration.redirectOutput || debugConfiguration.redirectOutput === undefined) {
            this.debugOption(debugOptions, DebugOptions.RedirectOutput);
        }

        // We'll need paths to be fixed only in the case where local and remote hosts are the same
        // I.e. only if hostName === 'localhost' or '127.0.0.1' or ''
        const isLocalHost = this.isLocalHost(debugConfiguration.host);
        if (this.platformService.isWindows && isLocalHost) {
            this.debugOption(debugOptions, DebugOptions.FixFilePathCase);
        }
        if (this.platformService.isWindows) {
            this.debugOption(debugOptions, DebugOptions.WindowsClient);
        } else {
            this.debugOption(debugOptions, DebugOptions.UnixClient);
        }
        if (debugConfiguration.showReturnValue) {
            this.debugOption(debugOptions, DebugOptions.ShowReturnValue);
        }

        if (!debugConfiguration.pathMappings) {
            debugConfiguration.pathMappings = [];
        }
        // This is for backwards compatibility.
        if (debugConfiguration.localRoot && debugConfiguration.remoteRoot) {
            debugConfiguration.pathMappings!.push({
                localRoot: debugConfiguration.localRoot,
                remoteRoot: debugConfiguration.remoteRoot
            });
        }
        // If attaching to local host, then always map local root and remote roots.
        if (workspaceFolder && debugConfiguration.host &&
            ['LOCALHOST', '127.0.0.1', '::1'].indexOf(debugConfiguration.host.toUpperCase()) >= 0) {
                let configPathMappings;
                if (debugConfiguration.pathMappings!.length === 0) {
                    configPathMappings = [{
                        localRoot: workspaceFolder.fsPath,
                        remoteRoot: workspaceFolder.fsPath
                    }];
                } else {
                    // Expand ${workspaceFolder} variable first if necessary.
                    const systemVariables = new SystemVariables(workspaceFolder.fsPath);
                    configPathMappings = debugConfiguration.pathMappings.map(({ localRoot: mappedLocalRoot, remoteRoot }) => ({
                        localRoot: systemVariables.resolveAny(mappedLocalRoot),
                        remoteRoot
                    }));
                }
                // If on Windows, lowercase the drive letter for path mappings.
                let pathMappings = configPathMappings;
                if (this.platformService.isWindows) {
                    pathMappings = configPathMappings.map(({ localRoot: windowsLocalRoot, remoteRoot }) => {
                        let localRoot = windowsLocalRoot;
                        if (windowsLocalRoot.match(/^[A-Z]:/)) {
                            localRoot = `${windowsLocalRoot[0].toLowerCase()}${windowsLocalRoot.substr(1)}`;
                        }
                        return { localRoot, remoteRoot };
                    });
                }
                debugConfiguration.pathMappings = pathMappings;
        }
        this.sendTelemetry('attach', debugConfiguration);
    }
}
