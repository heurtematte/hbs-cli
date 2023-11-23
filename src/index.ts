#!/usr/bin/env node
import { resolve as resolvePath, basename, extname } from 'path';
import Handlebars from 'handlebars';
import minimist from 'minimist';
import glob from 'glob-promise';
import packageJson from '../package.json';
import resolveNode from 'resolve';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import merge from 'lodash.merge';

const debug = require('debug')('hbs');
function resolve(file:string, options:any) {
  return new Promise((resolvePromise, reject) => resolveNode(file, options, (error, path) => {
    if (error) {
      reject(error);
    } else {
      resolvePromise(path);
    }
  }));
}
export async function resolveModuleOrGlob(path:string, cwd = process.cwd()) {
  try {
    debug(`Trying to require ${path} as a node_module`);
    return [ await resolve(path, { basedir: cwd }) ];
  } catch (error) {
    debug(`${path} is glob or actual file, expanding...`);
    return await glob(path, { cwd });
  }
}

export async function expandGlobList(globs:any): Promise<[string]> {
  if (typeof globs === 'string') {
    globs = [ globs ];
  }
  if (Array.isArray(globs) === false) {
    throw new Error(`expandGlobList expects Array or String, given ${typeof globs}`);
  }
  return (await Promise.all(
    globs.map((path:string) => resolveModuleOrGlob(path))
  )).reduce((total, current) => total.concat(current), []) as [string];
}

export function addHandlebarsHelpers(files:[string]) {
  files.forEach((file) => {
    debug(`Requiring ${file}`);
    const handlebarsHelper = require(file); // eslint-disable-line global-require
    if (handlebarsHelper && typeof handlebarsHelper.register === 'function') {
      debug(`${file} has a register function, registering with handlebars`);
      handlebarsHelper.register(Handlebars);
    } else {
      console.error(`WARNING: ${file} does not export a 'register' function, cannot import`);
    }
  });
}

export async function addHandlebarsPartials(files:[string]) {
  await Promise.all(files.map(async function registerPartial(file) {
    debug(`Registering partial ${file}`);
    Handlebars.registerPartial(basename(file, extname(file)), await readFile(file, { encoding: 'utf8' }));
  }));
}

export async function addObjectsToData(objects:any) {
  if (typeof objects === 'string') {
    objects = [ objects ];
  }
  if (Array.isArray(objects) === false) {
    throw new Error(`addObjectsToData expects Array or String, given ${typeof objects}`);
  }
  const dataSets:any = [];
  const files = await expandGlobList(objects.filter((object:any) => {
    try {
      debug(`Attempting to parse ${object} as JSON`);
      dataSets.push(JSON.parse(object));
      return false;
    } catch (error) {
      return true;
    }
  }));
  const fileContents = await Promise.all(
    files.map(async function registerPartial(file:string): Promise<string> {
      debug(`Loading JSON file ${file}`);
      return JSON.parse(await readFile(file, { encoding: 'utf8' }));
    })
  );
  return merge({}, ...dataSets.concat(fileContents));
}

// https://gist.github.com/miguelmota/4cdaa19a78f5684caa5146d93bdc57c1
async function readStdinSync():Promise<string> {
  return new Promise(resolve => {
    let data = ''
    process.stdin.setEncoding('utf8')
    process.stdin.resume()
    const t = setTimeout(() => {
      process.stdin.pause()
      resolve(data)
    }, 1e3)
    process.stdin.on('readable', () => {
      let chunk
      while ((chunk = process.stdin.read())) {
        data += chunk
      }
    }).on('end', () => {
      clearTimeout(t)
      resolve(data)
    })
  })
}

export async function getStdinData() {
  const text = await readStdinSync();
  try {
    debug(`Attempting to parse ${text} as JSON`);
    return JSON.parse(text);
  } catch (error) {
    throw new Error(`stdin cannot be parsed as JSON`);
  }
}

export async function renderHandlebarsTemplate(
  files:[string], outputDirectory = process.cwd(),
  outputExtension = 'html', data = {}, stdout = false) {
  await Promise.all(files.map(async function renderTemplate(file) {
    debug(`Rendering template ${file} with data`, data);
    const path = resolvePath(outputDirectory, `${basename(file, extname(file))}.${outputExtension}`);
    const htmlContents = Handlebars.compile(await readFile(file, { encoding: 'utf8' }))(data);
    if (stdout) {
      await process.stdout.write(htmlContents, 'utf8');
    } else {
      await mkdir(outputDirectory, { recursive: true });
      await writeFile(path, htmlContents);
      debug(`Wrote ${path}`);
      console.error(`Wrote ${path} from ${file}`);
    }
  }));
}

if (require.main === module) {
  const options = minimist(process.argv.slice(2), {
    string: [
      'output',
      'extension',
      'partial',
      'helper',
      'data',
    ],
    boolean: [
      'version',
      'help',
      'stdout',
      'stdin',
    ],
    alias: {
      'v': 'version',
      'h': 'help',
      'o': 'output',
      'e': 'extension',
      's': 'stdout',
      'i': 'stdin',
      'D': 'data',
      'P': 'partial',
      'H': 'helper',
    },
  });
  debug('Parsed argv', options);
  if (options.version) {
    console.error(packageJson.version);
  } else if (options.help || !options._ || !options._.length) {
    console.error(`
    Usage:
      hbs --version
      hbs --help
      hbs [-P <partial>]... [-H <helper>]... [-D <data>]... [-o <directory>] [--] (<template...>)

      -h, --help                 output usage information
      -v, --version              output the version number
      -o, --output <directory>   Directory to output rendered templates, defaults to cwd
      -e, --extension            Output extension of generated files, defaults to html
      -s, --stdout               Output to standard output
      -i, --stdin                Receive data directly from stdin
      -P, --partial <glob>...    Register a partial (use as many of these as you want)
      -H, --helper <glob>...     Register a helper (use as many of these as you want)

      -D, --data <glob|json>...  Parse some data

    Examples:

    hbs --helper handlebars-layouts --partial ./templates/layout.hbs -- ./index.hbs
    hbs --data ./package.json --data ./extra.json ./homepage.hbs --output ./site/
    hbs --helper ./helpers/* --partial ./partials/* ./index.hbs # Supports globs!
    `);
  } else {
    const setup = [];
    let data = {};
    if (options.helper) {
      debug('Setting up helpers', options.helper);
      setup.push(expandGlobList(options.helper).then(addHandlebarsHelpers));
    }
    if (options.partial) {
      debug('Setting up partials', options.partial);
      setup.push(expandGlobList(options.partial).then(addHandlebarsPartials));
    }
    if (options.data) {
      debug('Setting up data', options.data);
      setup.push(addObjectsToData(options.data).then((result) => data = result));
    }
    if (options.stdin) {
      debug('Setting up stdin', options.stdin);
      setup.push(getStdinData().then((stdinData) => data = stdinData));
    }
    Promise.all(setup)
      .then(() => expandGlobList(options._))
      .then((files) => renderHandlebarsTemplate(files, options.output, options.extension, data, options.stdout))
      .catch((error) => {
        console.error(error.stack || error);
        process.exit(1);
      });
  }
}
