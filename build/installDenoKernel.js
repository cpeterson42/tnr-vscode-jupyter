"use strict";
// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.
Object.defineProperty(exports, "__esModule", { value: true });
const path = require("path");
const os = require("os");
const fs = require("fs-extra");
const child_process_1 = require("child_process");
const winJupyterPath = path.join('AppData', 'Roaming', 'jupyter', 'kernels');
const linuxJupyterPath = path.join('.local', 'share', 'jupyter', 'kernels');
const macJupyterPath = path.join('Library', 'Jupyter', 'kernels');
var OSType;
(function (OSType) {
    OSType["Unknown"] = "Unknown";
    OSType["Windows"] = "Windows";
    OSType["OSX"] = "OSX";
    OSType["Linux"] = "Linux";
})(OSType || (OSType = {}));
// Return the OS type for the given platform string.
function getOSType(platform = process.platform) {
    if (/^win/.test(platform)) {
        return OSType.Windows;
    }
    else if (/^darwin/.test(platform)) {
        return OSType.OSX;
    }
    else if (/^linux/.test(platform)) {
        return OSType.Linux;
    }
    else {
        return OSType.Unknown;
    }
}
// Home path depends upon OS
const homePath = os.homedir();
function getEnvironmentVariable(key) {
    return process.env[key];
}
function getUserHomeDir() {
    if (getOSType() === OSType.Windows) {
        return getEnvironmentVariable('USERPROFILE') || homePath;
    }
    const homeVar = getEnvironmentVariable('HOME') || getEnvironmentVariable('HOMEPATH') || homePath;
    // Make sure if linux, it uses linux separators
    return homeVar.replace(/\\/g, '/');
}
function getKernelSpecRootPath() {
    switch (getOSType()) {
        case OSType.Windows:
            return path.join(getUserHomeDir(), winJupyterPath);
        case OSType.OSX:
            return path.join(getUserHomeDir(), macJupyterPath);
        default:
            return path.join(getUserHomeDir(), linuxJupyterPath);
    }
}
function getDenoExec() {
    return (0, child_process_1.execSync)('which deno').toString().trim();
}
function getDenoKernelSpecPath() {
    return path.join(getKernelSpecRootPath(), 'deno', 'kernel.json');
}
function registerKernel() {
    const denoKernelSpecPath = getDenoKernelSpecPath();
    if (fs.existsSync(denoKernelSpecPath)) {
        console.log(`Deno kernel already registered at ${denoKernelSpecPath}`);
        return;
    }
    fs.mkdirpSync(path.dirname(denoKernelSpecPath));
    fs.writeFileSync(denoKernelSpecPath, JSON.stringify({
        argv: [getDenoExec(), '--unstable', 'jupyter', '--kernel', '--conn', '{connection_file}'],
        display_name: 'Deno',
        language: 'typescript'
    }, null, 4));
    console.log(`Deno kernel registered at ${denoKernelSpecPath}`);
}
registerKernel();
//# sourceMappingURL=installDenoKernel.js.map