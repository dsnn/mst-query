// @ts-nocheck
import path from 'path';
import arg from 'arg';
import { cosmiconfigSync } from 'cosmiconfig';
import { Config } from '../src/models';

const explorer = cosmiconfigSync('mst-query-generator');

export const getConfig = (): Config => {
    const args = parseArgs();
    return parseConfigOrDefault(args);
};

const parseArgs = () => {
    const availableArgs = {
        '--force': Boolean,
        '--outDir': String,
        '--verbose': Boolean,
        '--models': Boolean,
    };

    try {
        return arg(availableArgs);
    } catch (e) {
        const errorMessage = [
            'Example usage: ',
            'generator',
            '--outDir=<path>',
            '--force=<true|false>',
            '--verbose=<true|false>',
            '--models=<true|false>',
            'graphql-schema.graphql',
        ];
        console.error(`${errorMessage.join('\n\t')}\n`);
        console.error(`Valid options: ${Object.keys(availableArgs).join(', ')}\n`);
        throw e;
    }
};

export const parseConfigOrDefault = (args: arg.Result<arg.Spec>): Config => {
    const configArgs = {
        force: args['--force'] || false,
        input: args._[0] || `${path.resolve(__dirname)}/schema.graphql`,
        outDir: path.resolve(process.cwd(), args['--outDir'] || './models'),
        verbose: args['--verbose'] || false,
        models: args['--models'] || false,
    };
    const defaultConfig = new Config(configArgs);

    try {
        console.log('Searching for configuration...');
        const result = explorer.search();

        if (result) {
            return result.config;
        }

        console.log('Configuration not found, using default config');

        return defaultConfig;
    } catch (e) {
        console.error(e.message);
        return defaultConfig;
    }
};
