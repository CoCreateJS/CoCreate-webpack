/**
 * @fileoverview Webpack plugins and loaders for the CoCreate ecosystem.
 * Includes module generation, automated file uploading, and symlink management.
 */

const fs = require("fs");
const path = require("path");

/**
 * Import the upload function from CoCreate CLI to handle automated file uploads.
 * This function synchronizes local changes with the CoCreate cloud environment.
 */
const upload = require("@cocreate/cli/src/commands/upload.js");

/**
 * @class ModuleGenerator
 * @description A Webpack plugin that dynamically generates a module entry file 
 * (typically `CoCreate.modules.js`) based on a configuration object. It leverages 
 * `@cocreate/lazy-loader` for efficient code splitting and dependency management.
 */
class ModuleGenerator {
    /**
     * @constructor
     * @param {Object} pluginOptions - The configuration for the plugin.
     * @param {Object} [pluginOptions.config] - Direct CoCreate configuration object.
     * @param {string} [pluginOptions.configPath] - Path to a CoCreate config file.
     */
    constructor(pluginOptions) {
        /** @type {Object} */
        this.pluginOptions = pluginOptions;
    }

    /**
     * @method apply
     * @description Entry point for the Webpack plugin. Taps into the `beforeCompile` hook.
     * @param {import('webpack').Compiler} compiler - The Webpack compiler instance.
     */
    apply(compiler) {
        let CoCreateConfig;

        // Resolve configuration source
        if (typeof this.pluginOptions === "object") {
            CoCreateConfig = this.pluginOptions;
        } else if (this.pluginOptions && this.pluginOptions.configPath) {
            try {
                CoCreateConfig = require(this.pluginOptions.configPath);
            } catch (error) {
                console.error("Error loading CoCreate config file:", error);
                throw error;
            }
        } else {
            console.error("ModuleGenerator requires either a 'config' object or 'configPath' string.");
            return;
        }

        /** @type {boolean} Track if modules have already been generated to avoid redundant writes. */
        let modulesGenerated = false;

        compiler.hooks.beforeCompile.tapAsync(
            "CoCreateLazyloader",
            (params, callback) => {
                if (modulesGenerated) {
                    callback();
                } else {
                    // Fetch the output path from the root of the config, with a fallback
                    const outputPath = this.pluginOptions.moduleOutputPath || "./CoCreate.modules.js";
                    let moduleContent = `import { dependency, lazyLoad } from '@cocreate/lazy-loader';\n\n`;

                    // Ensure we are explicitly targeting the 'modules' namespace
                    const modulesObj = CoCreateConfig.modules || {};

                    // Generate import statements based on module metadata
                    Object.entries(modulesObj).forEach(
                        ([moduleName, moduleInfo]) => {
                            // Skip non-objects
                            if (typeof moduleInfo !== "object" || moduleInfo === null) return;
                            
                            // Skip items that do not have an import defined (acts as 'continue' in forEach)
                            if (!moduleInfo.import) return;

                            if (moduleInfo.selector) {
                                // Logic for lazy-loading based on DOM selectors
                                const sanitizedSelector = moduleInfo.selector.replaceAll("'", '"');
                                moduleContent += `lazyLoad('${moduleName}', '${sanitizedSelector}', () => import(/*webpackChunkName: "${moduleName}-chunk"*/ '${moduleInfo.import}'));\n`;
                            } else {
                                // Logic for standard dependencies
                                moduleContent += `dependency('${moduleName}', import(/*webpackChunkName: "${moduleName}-chunk"*/ '${moduleInfo.import}'));\n`;
                            }
                        }
                    );

                    // Persist the generated module file to disk
                    fs.writeFile(outputPath, moduleContent, (err) => {
                        if (err) {
                            console.error(`Error writing ${outputPath}:`, err);
                            callback(err);
                        } else {
                            modulesGenerated = true;
                            console.log(`${outputPath} generated successfully.`);
                            callback();
                        }
                    });
                }
            }
        );
    }
}

/**
 * @class FileUploader
 * @description Handles automated file uploads to the CoCreate platform, 
 * primarily intended for use during Webpack's 'watch' mode to sync local changes.
 */
class FileUploader {
    /**
     * @constructor
     * @param {Object} env - Environment variables passed from the Webpack CLI.
     * @param {Object} argv - Command line arguments (used to detect --watch).
     */
    constructor(env, argv) {
        /** @type {Object} */
        this.env = env;
        /** @type {boolean} Internal state to prevent multiple upload triggers. */
        this.isWatching = false;
        /** @type {boolean} Flag indicating if Webpack is in watch mode. */
        this.isWatch = argv.watch === true;
    }

    /**
     * @method apply
     * @description Hooks into the compilation process to trigger uploads.
     * @param {import('webpack').Compiler} compiler - The Webpack compiler instance.
     */
    apply(compiler) {
        if (this.isWatch) {
            // Optional: Upload files before the first compilation starts
            if (this.env.beforeCompilation) {
                upload(process.cwd(), ["../", "-w"]);
            }

            // Upload files after assets are emitted to the output directory
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
 * @class SymlinkCreator
 * @description A utility plugin that creates symbolic links after the build process.
 * This is used to map PWA assets and distribution folders to the project root.
 */
class SymlinkCreator {
    /**
     * @constructor
     * @param {Object} [options] - Configuration options for symlink behavior.
     */
    constructor(options) {
        /** @type {Object|undefined} */
        this.options = options;
    }

    /**
     * @method apply
     * @description Taps into the `afterEmit` hook to create symlinks once files are generated.
     * @param {import('webpack').Compiler} compiler - The Webpack compiler instance.
     */
    apply(compiler) {
        compiler.hooks.afterEmit.tap("SymlinkPlugin", (compilation) => {
            // Standard symlink mappings for CoCreate PWA structure
            // this.createSymlink("./dist", "../dist", "dir");
            // this.createSymlink("./node_modules/@cocreate/pwa/src/service-worker.js", "../service-worker.js", "file");
            // this.createSymlink("./node_modules/@cocreate/pwa/src/manifest.webmanifest", "../manifest.webmanifest", "file");
            // this.createSymlink("./node_modules/@cocreate/pwa/src/offline.html", "../offline.html", "file");
        });
    }

    /**
     * @method createSymlink
     * @description Helper method to safely create a symlink if the target exists and the destination is free.
     * @param {string} target - The source path (relative or absolute).
     * @param {string} destination - The target link path (relative or absolute).
     * @param {string} type - The type of symlink ('file', 'dir', or 'junction').
     */
    createSymlink(target, destination, type) {
        if (fs.existsSync(target)) {
            const absoluteTarget = path.resolve(target);
            if (!fs.existsSync(destination)) {
                const absoluteDestination = path.resolve(destination);
                fs.symlink(absoluteTarget, absoluteDestination, type, (err) => {
                    if (err) {
                        console.error(`Failed to create symlink at ${destination}:`, err);
                    } else {
                        console.log(`Symlink created: ${target} -> ${destination}`);
                    }
                });
            }
        }
    }
}

/**
 * @exports
 * @property {ModuleGenerator} ModuleGenerator - Dynamic module builder plugin.
 * @property {FileUploader} FileUploader - CLI upload integration plugin.
 * @property {SymlinkCreator} SymlinkCreator - PWA/dist symlink management plugin.
 * @property {string} UnicodeLoader - Absolute path to the unicode replacement loader.
 */
module.exports = { 
    ModuleGenerator, 
    FileUploader, 
    SymlinkCreator, 
    UnicodeLoader: path.resolve(__dirname, 'replace-unicode.js') 
};