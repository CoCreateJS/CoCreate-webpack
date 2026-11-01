/**
 * @fileoverview Webpack plugins and loaders for the CoCreate ecosystem.
 * Includes unified entry generation (`CoCreate.entry.js`), automated file uploading, and symlink management.
 * @environment tooling
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
 * @public
 * @environment tooling
 */
class ModuleGenerator {
    /**
     * @constructor
     * @param {Object} [pluginOptions={}] - Options for the generator plugin.
     * @param {Object} [pluginOptions.config] - Direct CoCreate configuration object.
     * @param {string} [pluginOptions.configPath] - Path to a CoCreate config file.
     * @param {string} [pluginOptions.entryOutputPath="./CoCreate.entry.js"] - Path for generated unified entry file.
     * @public
     * @environment tooling
     */
    constructor(pluginOptions = {}) {
        /** @type {Object}
         * @public
         * @environment tooling
         */
        this.pluginOptions = pluginOptions;
    }

    /**
     * @method apply
     * @description Taps into Webpack's `beforeCompile` hook to write the unified entry file.
     * @param {import('webpack').Compiler} compiler - The Webpack compiler instance.
     * @public
     * @environment tooling
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

        /** @type {boolean} State flag to avoid redundant disk writes during watch mode recompiles.
         * @private
         * @environment tooling
         */
        let entryGenerated = false;

        compiler.hooks.beforeCompile.tapAsync(
            "CoCreateGenerator",
            (params, callback) => {
                if (entryGenerated) {
                    return callback();
                }

                const entryOutputPath = this.pluginOptions.entryOutputPath || "./CoCreate.index.js";

                let entryContent = `import { dependency, lazyLoad } from '@cocreate/lazy-loader';\n\n`;

                const pluginsObj = Object.fromEntries(
                    Object.entries(CoCreateConfig.plugins || {})
                        .filter(([, pluginInfo]) =>
                            pluginInfo && typeof pluginInfo === "object" &&
                            (pluginInfo.js !== undefined || pluginInfo.css !== undefined)
                        )
                        .map(([pluginName, pluginInfo]) => [pluginName, {
                            ...(pluginInfo.js !== undefined ? { js: pluginInfo.js } : {}),
                            ...(pluginInfo.css !== undefined ? { css: pluginInfo.css } : {})
                        }])
                );
                entryContent += `if (typeof window !== 'undefined') {\n`;
                entryContent += `    window.CoCreateConfig = window.CoCreateConfig || {};\n`;
                entryContent += `    window.CoCreateConfig.plugins = Object.assign(\n`;
                entryContent += `        {},\n`;
                entryContent += `        window.CoCreateConfig.plugins || {},\n`;
                entryContent += `        ${JSON.stringify(pluginsObj, null, 4)}\n`;
                entryContent += `    );\n`;
                entryContent += `}\n\n`;

                const appendImports = (entries) => {
                    Object.entries(entries || {}).forEach(([name, info]) => {
                        if (typeof info !== "object" || info === null || !info.import) return;

                        const importPath = JSON.stringify(info.import);
                        const chunkName = name.replace(/[^A-Za-z0-9_-]/g, "-");
                        const importExpression = `import(/* webpackChunkName: "${chunkName}" */ ${importPath})`;
                        if (info.selector) {
                            entryContent += `lazyLoad(${JSON.stringify(name)}, ${JSON.stringify(info.selector)}, () => ${importExpression});\n`;
                        } else {
                            entryContent += `dependency(${JSON.stringify(name)}, ${importExpression});\n`;
                        }
                    });
                };

                appendImports(CoCreateConfig.plugins);
                appendImports(CoCreateConfig.modules);

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
 * @public
 * @environment tooling
 */
class FileUploader {
    /**
     * @constructor
     * @param {Object} [env={}] - Environment variables passed from the Webpack CLI.
     * @param {Object} [argv={}] - Command line arguments.
     * @public
     * @environment tooling
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
     * @public
     * @environment tooling
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

/**
 * SymlinkCreator public API.
 *
 * @public
 * @environment tooling
 */
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

/**
 * UnicodeLoader public API.
 *
 * @name UnicodeLoader
 * @public
 * @environment tooling
 */

/**
 * A Webpack integration tool for CoCreate applications, enabling file watching, automated chunking, lazy loading, and file uploading. It leverages CoCreate.config for streamlined project builds and development workflows.
 *
 * @module webpack
 * @environment tooling
 */
