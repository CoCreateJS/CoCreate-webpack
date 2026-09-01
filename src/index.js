/**
 * @fileoverview Webpack plugins and loaders for the CoCreate ecosystem.
 * Includes unified entry generation (`CoCreate.entry.js`), automated file uploading, and symlink management.
 */

const fs = require("fs");
const path = require("path");

let upload;
try {
    upload = require("@cocreate/cli/src/commands/upload.js");
} catch (e) {
    // Graceful fallback if @cocreate/cli is not present in local dependencies
    upload = null;
}

/**
 * @class ModuleGenerator
 * @description Webpack plugin that generates a single unified entry file (`CoCreate.entry.js`)
 * containing both global plugin configuration and `@cocreate/lazy-loader` declarations.
 */
class ModuleGenerator {
    /**
     * @constructor
     * @param {Object} [pluginOptions={}] - Options for the generator plugin.
     * @param {Object} [pluginOptions.config] - Direct CoCreate configuration object.
     * @param {string} [pluginOptions.configPath] - Path to a CoCreate config file.
     * @param {string} [pluginOptions.entryOutputPath="./CoCreate.entry.js"] - Path for generated unified entry file.
     */
    constructor(pluginOptions = {}) {
        /** @type {Object} */
        this.pluginOptions = pluginOptions;
    }

    /**
     * @method apply
     * @description Taps into Webpack's `beforeCompile` hook to write the unified entry file.
     * @param {import('webpack').Compiler} compiler - The Webpack compiler instance.
     */
    apply(compiler) {
        let CoCreateConfig = null;

        if (this.pluginOptions.config && typeof this.pluginOptions.config === "object") {
            CoCreateConfig = this.pluginOptions.config;
        } else if (this.pluginOptions.configPath) {
            try {
                const resolvedPath = path.isAbsolute(this.pluginOptions.configPath) 
                    ? this.pluginOptions.configPath 
                    : path.resolve(process.cwd(), this.pluginOptions.configPath);
                CoCreateConfig = require(resolvedPath);
            } catch (error) {
                console.error("[ModuleGenerator] Error loading CoCreate config file:", error);
                throw error;
            }
        } else if (typeof this.pluginOptions === "object" && Object.keys(this.pluginOptions).length > 0) {
            CoCreateConfig = this.pluginOptions;
        }

        if (!CoCreateConfig) {
            console.error("[ModuleGenerator] Requires either a 'config' object or 'configPath' string.");
            return;
        }

        /** @type {boolean} State flag to avoid redundant disk writes during watch mode recompiles. */
        let entryGenerated = false;

        compiler.hooks.beforeCompile.tapAsync(
            "CoCreateGenerator",
            (params, callback) => {
                if (entryGenerated) {
                    return callback();
                }

                const entryOutputPath = this.pluginOptions.entryOutputPath || "./CoCreate.index.js";

                let entryContent = `import { dependency, lazyLoad } from '@cocreate/lazy-loader';\n\n`;

                const pluginsObj = CoCreateConfig.plugins || {};
                entryContent += `if (typeof window !== 'undefined') {\n`;
                entryContent += `    window.CoCreateConfig = window.CoCreateConfig || {};\n`;
                entryContent += `    window.CoCreateConfig.plugins = Object.assign(\n`;
                entryContent += `        {},\n`;
                entryContent += `        window.CoCreateConfig.plugins || {},\n`;
                entryContent += `        ${JSON.stringify(pluginsObj, null, 4)}\n`;
                entryContent += `    );\n`;
                entryContent += `}\n\n`;

                const modulesObj = CoCreateConfig.modules || {};
                Object.entries(modulesObj).forEach(([moduleName, moduleInfo]) => {
                    if (typeof moduleInfo !== "object" || moduleInfo === null) return;
                    if (!moduleInfo.import) return;

                    if (moduleInfo.selector) {
                        const sanitizedSelector = moduleInfo.selector.replaceAll("'", '"');
                        entryContent += `lazyLoad('${moduleName}', '${sanitizedSelector}', () => import(/*webpackChunkName: "${moduleName}"*/ '${moduleInfo.import}'));\n`;
                    } else {
                        entryContent += `dependency('${moduleName}', import(/*webpackChunkName: "${moduleName}"*/ '${moduleInfo.import}'));\n`;
                    }
                });

                fs.writeFile(entryOutputPath, entryContent, "utf8", (err) => {
                    if (err) {
                        console.error(`[@cocreate/webpack] Error writing ${entryOutputPath}:`, err);
                        return callback(err);
                    }
                    entryGenerated = true;
                    console.log(`[@cocreate/webpack] ${entryOutputPath} generated successfully.`);
                    callback();
                });
            }
        );
    }
}

/**
 * @class FileUploader
 * @description Handles automated file uploads to the CoCreate platform during Webpack watch mode.
 */
class FileUploader {
    /**
     * @constructor
     * @param {Object} [env={}] - Environment variables passed from the Webpack CLI.
     * @param {Object} [argv={}] - Command line arguments.
     */
    constructor(env = {}, argv = {}) {
        this.env = env;
        this.isWatching = false;
        this.isWatch = argv.watch === true;
    }

    /**
     * @method apply
     * @description Hooks into compilation hooks to upload files to CoCreate.
     * @param {import('webpack').Compiler} compiler - The Webpack compiler instance.
     */
    apply(compiler) {
        if (this.isWatch && upload) {
            if (this.env.beforeCompilation) {
                upload(process.cwd(), ["../", "-w"]);
            }

            if (this.env.afterCompilation) {
                compiler.hooks.emit.tapAsync(
                    "watchFiles",
                    (compilation, callback) => {
                        if (!this.isWatching) {
                            this.isWatching = true;
                            upload(process.cwd(), ["../", "-w"]);
                        }
                        callback();
                    }
                );
            }
        }
    }
}

class SymlinkCreator {
    apply(compiler) {
        // Symlink creation logic can be tapped here if required
    }
}

module.exports = { 
    ModuleGenerator, 
    FileUploader, 
    SymlinkCreator, 
    UnicodeLoader: path.resolve(__dirname, 'replace-unicode.js') 
};
