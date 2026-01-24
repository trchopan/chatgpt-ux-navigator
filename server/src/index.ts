import { parseArgv } from './config/argv';
import { makeConfig } from './config/config';
import { startServer } from './http/server';

const partialConfig = parseArgv(process.argv);
const config = makeConfig(partialConfig);

startServer(config);
