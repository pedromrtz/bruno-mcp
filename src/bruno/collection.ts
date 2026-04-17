/**
 * Bruno collection management
 * Handles creation and management of Bruno collections
 */

import { promises as fs } from "fs";
import { join } from "path";
import { BrunoCollection, BrunoCollectionSummary, CreateCollectionInput, FileOperationResult, BrunoError, BruFileError } from "./types.js";

export class CollectionManager {
    /**
     * Create a new Bruno collection
     */
    async createCollection(input: CreateCollectionInput): Promise<FileOperationResult> {
        try {
            // Validate input
            this.validateCollectionInput(input);

            // Create collection directory
            const collectionPath = join(input.outputPath, input.name);
            await this.ensureDirectory(collectionPath);

            // Create bruno.json configuration
            const brunoConfig: BrunoCollection = {
                version: "1",
                name: input.name,
                type: "collection",
                ignore: input.ignore || ["node_modules", ".git", ".env"],
            };

            const configPath = join(collectionPath, "bruno.json");
            await fs.writeFile(configPath, JSON.stringify(brunoConfig, null, 2));

            // Create environments directory
            const envPath = join(collectionPath, "environments");
            await this.ensureDirectory(envPath);

            // Create .gitignore if it doesn't exist
            const gitignorePath = join(collectionPath, ".gitignore");
            const gitignoreExists = await this.fileExists(gitignorePath);
            if (!gitignoreExists) {
                await this.createGitignore(gitignorePath);
            }

            // Create README.md with basic collection info
            const readmePath = join(collectionPath, "README.md");
            await this.createCollectionReadme(readmePath, input);

            return {
                success: true,
                path: collectionPath,
            };
        } catch (error) {
            return {
                success: false,
                error: error instanceof Error ? error.message : "Unknown error",
            };
        }
    }

    /**
     * Load an existing Bruno collection
     */
    async loadCollection(collectionPath: string): Promise<BrunoCollection> {
        try {
            const configPath = join(collectionPath, "bruno.json");
            const configContent = await fs.readFile(configPath, "utf-8");
            const config = JSON.parse(configContent) as BrunoCollection;

            this.validateCollectionConfig(config);
            return config;
        } catch (error) {
            throw new BruFileError(`Failed to load collection from ${collectionPath}`, { originalError: error });
        }
    }

    /**
     * Update collection configuration
     */
    async updateCollection(collectionPath: string, updates: Partial<BrunoCollection>): Promise<FileOperationResult> {
        try {
            const existingConfig = await this.loadCollection(collectionPath);
            const updatedConfig = { ...existingConfig, ...updates };

            this.validateCollectionConfig(updatedConfig);

            const configPath = join(collectionPath, "bruno.json");
            await fs.writeFile(configPath, JSON.stringify(updatedConfig, null, 2));

            return {
                success: true,
                path: configPath,
            };
        } catch (error) {
            return {
                success: false,
                error: error instanceof Error ? error.message : "Unknown error",
            };
        }
    }

    /**
     * List all .bru files in a collection
     */
    async listRequests(collectionPath: string): Promise<string[]> {
        try {
            const bruFiles: string[] = [];
            await this.findBruFiles(collectionPath, bruFiles);
            return bruFiles.sort();
        } catch (error) {
            throw new BruFileError(`Failed to list requests in collection ${collectionPath}`, { originalError: error });
        }
    }

    /**
     * Create a folder structure within the collection
     */
    async createFolder(collectionPath: string, folderPath: string): Promise<FileOperationResult> {
        try {
            const fullPath = join(collectionPath, folderPath);
            await this.ensureDirectory(fullPath);

            return {
                success: true,
                path: fullPath,
            };
        } catch (error) {
            return {
                success: false,
                error: error instanceof Error ? error.message : "Unknown error",
            };
        }
    }

    /**
     * Get collection statistics
     */
    async getCollectionStats(collectionPath: string): Promise<{
        totalRequests: number;
        requestsByMethod: Record<string, number>;
        folders: string[];
        environments: string[];
    }> {
        try {
            const requests = await this.listRequests(collectionPath);
            const folders = await this.listFolders(collectionPath);
            const environments = await this.listEnvironments(collectionPath);

            // Count requests by method (would need to parse .bru files)
            const requestsByMethod: Record<string, number> = {};

            // For now, return basic stats
            return {
                totalRequests: requests.length,
                requestsByMethod,
                folders,
                environments,
            };
        } catch (error) {
            throw new BruFileError(`Failed to get collection stats for ${collectionPath}`, { originalError: error });
        }
    }

    /**
     * List all Bruno collections found in a directory tree
     */
    async listCollections(basePath: string, maxDepth = 10): Promise<BrunoCollectionSummary[]> {
        try {
            const baseStats = await fs.stat(basePath);
            if (!baseStats.isDirectory()) {
                throw new BrunoError("Path must be a directory", "VALIDATION_ERROR");
            }

            const collectionPaths: string[] = [];
            await this.findCollectionPaths(basePath, collectionPaths, 0, maxDepth);

            const collectionSummaries = await Promise.all(
                collectionPaths.map(async (collectionPath) => {
                    const collection = await this.loadCollection(collectionPath);
                    const requests = await this.listRequests(collectionPath);
                    const environments = await this.listEnvironments(collectionPath);

                    return {
                        name: collection.name,
                        path: collectionPath,
                        requestCount: requests.length,
                        environmentCount: environments.length,
                    };
                }),
            );

            return collectionSummaries.sort((a, b) => a.name.localeCompare(b.name));
        } catch (error) {
            if (error instanceof BrunoError) {
                throw error;
            }

            throw new BruFileError(`Failed to list collections in ${basePath}`, { originalError: error });
        }
    }

    /**
     * Validate collection input
     */
    private validateCollectionInput(input: CreateCollectionInput): void {
        if (!input.name || input.name.trim().length === 0) {
            throw new BrunoError("Collection name is required", "VALIDATION_ERROR");
        }

        if (!input.outputPath || input.outputPath.trim().length === 0) {
            throw new BrunoError("Output path is required", "VALIDATION_ERROR");
        }

        // Check for invalid characters in collection name
        const invalidChars = /[<>:"/\\|?*]/;
        if (invalidChars.test(input.name)) {
            throw new BrunoError("Collection name contains invalid characters", "VALIDATION_ERROR");
        }
    }

    /**
     * Validate collection configuration
     */
    private validateCollectionConfig(config: BrunoCollection): void {
        if (!config.name || config.name.trim().length === 0) {
            throw new BrunoError("Collection name is required", "VALIDATION_ERROR");
        }

        if (!config.version) {
            throw new BrunoError("Collection version is required", "VALIDATION_ERROR");
        }

        if (config.type !== "collection") {
            throw new BrunoError('Collection type must be "collection"', "VALIDATION_ERROR");
        }
    }

    /**
     * Ensure directory exists, create if it doesn't
     */
    private async ensureDirectory(dirPath: string): Promise<void> {
        try {
            await fs.access(dirPath);
        } catch {
            await fs.mkdir(dirPath, { recursive: true });
        }
    }

    /**
     * Check if file exists
     */
    private async fileExists(filePath: string): Promise<boolean> {
        try {
            await fs.access(filePath);
            return true;
        } catch {
            return false;
        }
    }

    /**
     * Create .gitignore file for Bruno collection
     */
    private async createGitignore(gitignorePath: string): Promise<void> {
        const gitignoreContent = `# Bruno collection files to ignore
*.tmp
*.temp
.env
.env.local
.env.*.local

# OS generated files
.DS_Store
Thumbs.db

# Editor files
.vscode/
.idea/
*.swp
*.swo
`;

        await fs.writeFile(gitignorePath, gitignoreContent);
    }

    /**
     * Create README.md for collection
     */
    private async createCollectionReadme(readmePath: string, input: CreateCollectionInput): Promise<void> {
        const readmeContent = `# ${input.name}

${input.description || "Bruno API testing collection"}

## Overview

This collection was generated using the Bruno MCP server.

${input.baseUrl ? `**Base URL:** \`${input.baseUrl}\`` : ""}

## Structure

- \`environments/\` - Environment configurations
- \`*.bru\` - API request files

## Usage

Run all tests:
\`\`\`bash
bruno-cli run
\`\`\`

Run specific environment:
\`\`\`bash
bruno-cli run --env production
\`\`\`

## Generated

Created on: ${new Date().toISOString()}
`;

        await fs.writeFile(readmePath, readmeContent);
    }

    /**
     * Recursively find all .bru files
     */
    private async findBruFiles(dirPath: string, bruFiles: string[]): Promise<void> {
        const entries = await fs.readdir(dirPath, { withFileTypes: true });

        for (const entry of entries) {
            const fullPath = join(dirPath, entry.name);

            if (entry.isDirectory() && entry.name !== "node_modules" && entry.name !== ".git") {
                await this.findBruFiles(fullPath, bruFiles);
            } else if (entry.isFile() && entry.name.endsWith(".bru")) {
                bruFiles.push(fullPath);
            }
        }
    }

    /**
     * Recursively find collection directories that contain bruno.json
     */
    private async findCollectionPaths(dirPath: string, collectionPaths: string[], depth: number, maxDepth: number): Promise<void> {
        if (depth > maxDepth) {
            return;
        }

        try {
            const configPath = join(dirPath, "bruno.json");
            const configExists = await this.fileExists(configPath);

            if (configExists) {
                try {
                    await this.loadCollection(dirPath);
                    collectionPaths.push(dirPath);
                } catch {
                    // Ignorar configs invalidas para continuar escaneo
                }
            }

            const entries = await fs.readdir(dirPath, { withFileTypes: true });

            for (const entry of entries) {
                if (!entry.isDirectory()) {
                    continue;
                }

                if (entry.name === "node_modules" || entry.name === ".git" || entry.name === "dist") {
                    continue;
                }

                const fullPath = join(dirPath, entry.name);
                await this.findCollectionPaths(fullPath, collectionPaths, depth + 1, maxDepth);
            }
        } catch {
            // Ignorar errores de acceso para continuar con el resto del arbol
        }
    }

    /**
     * List all folders in collection
     */
    private async listFolders(collectionPath: string): Promise<string[]> {
        const folders: string[] = [];
        const entries = await fs.readdir(collectionPath, { withFileTypes: true });

        for (const entry of entries) {
            if (entry.isDirectory() && entry.name !== "environments" && entry.name !== "node_modules" && entry.name !== ".git") {
                folders.push(entry.name);
            }
        }

        return folders.sort();
    }

    /**
     * List all environment files
     */
    private async listEnvironments(collectionPath: string): Promise<string[]> {
        try {
            const envPath = join(collectionPath, "environments");
            const entries = await fs.readdir(envPath, { withFileTypes: true });

            return entries
                .filter((entry) => entry.isFile() && entry.name.endsWith(".bru"))
                .map((entry) => entry.name.replace(".bru", ""))
                .sort();
        } catch {
            return [];
        }
    }
}

/**
 * Create a new collection manager instance
 */
export function createCollectionManager(): CollectionManager {
    return new CollectionManager();
}
