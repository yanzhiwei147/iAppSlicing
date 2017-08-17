#!/usr/bin/env node
'use strict';

const path = require('path');
const fs = require('fs-extra');
const fsExtra = require('fs-extra');
const os = require('os');
const childproc = require('child_process');
const spawn = require('child_process').spawn
const spawnSync = require('child_process').spawnSync
const EventEmitter = require('events').EventEmitter;
const decompress = require('decompress');
const plist = require('plist');
const find = require('find');
const zipper = require("zip-local");

// constant
const kExecutePattern  = /(.+\.appex|.+\.app|.+\.framework|.+\.dylib)$/;
const kEntitlementsSuffix  = '_entitlements.plist';

function execProgram(bin, arg, opt, cb) {
  if (!opt) {
    opt = {};
  }
  opt.maxBuffer = 1024 * 1024;
  // return childproc.execFile(bin, arg, opt, cb);
  const child = spawn(bin, arg, opt);
  child.stdout.on('data', (data) => {
    cb(undefined, `${data}`);
  });

  child.stderr.on('data', (data) => {
    cb(undefined, undefined, `${data}`);
  });

  child.on('close', (code) => {
    cb(undefined, undefined, undefined, `${code}` + "")
  });
}

function execProgramSync(bin, arg, opt) {
  if (!opt) {
    opt = {};
  }
  opt.maxBuffer = 1024 * 1024;
  return spawnSync(bin, arg, opt);
}

function isDirectory (directory) {
  try {
    return fsExtra.statSync(directory).isDirectory();
  } catch (e) {
    return false;
  }
}

function getSubDirectories(main) {
  return fs.readdirSync(main).filter(function (file) {
    return fs.statSync(path.join(main ,file)).isDirectory();
  });
}

function fileExist(file) {
  try {
    return fs.existsSync(file);
  } catch (e) {
    return false;
  }
}

function ensureDirExist(dir) {
  fsExtra.ensureDirSync(dir);
}

module.exports = class SlicingApp {
  constructor (state, onEnd) {
    this.config = JSON.parse(JSON.stringify(state));
    this.events = new EventEmitter();
    this.events.config = this.config;
    this.codesignContent = null;
    this.patchTypes = this.preparePatchTypes();
  }

  /* Event Wrapper API with cb support */
  emit (ev, msg, cb) {
    this.events.emit(ev, msg);
    if (typeof cb === 'function') {
      return cb(msg);
    }
  }

  on (ev, cb) {
    this.events.on(ev, cb);
    return this;
  }

  resign (cb) {
    if (typeof cb === 'function') {
      this.events.removeAllListeners('end');
      this.events.on('end', cb);
    }

    const configs = this.prepare();
    this.executeSlicing(configs, (error, stdout, stderr, code) => {
      if (error) {
        this.emit('error', error, cb);
      } else if (stdout) {
        this.emit('message', stdout);
      } else if (stderr) {
        this.emit('warning', stderr);
      }
      if (code) {
        this.emit('end');
      }
    });
    return this;
  }

  prepare() {
    let currentWorkingDirectory = path.resolve(process.cwd());

    // ipa file path
    let ipa = this.config["file"];
    let ipaFile = ipa
    if (!isDirectory(ipaFile) && !fileExist(ipaFile)) { 
      ipaFile = path.join(currentWorkingDirectory, ipaFile);     
    }

    // output directory
    var output = this.config["output"] || "";
    if (output.length == 0 || !isDirectory(output)) {
      output = path.dirname(ipaFile) + '/output';
    }

    // unzip directory
    var extractedDirectory = path.dirname(ipaFile) + '/extracted';

    // keychain
    let keychain = this.config["keychain"] || "login.keychain";

    // tmp directory
    let tmpDirectory = path.dirname(ipaFile) + '/tmp';
    
    return {
      keychain: keychain,
      ipa: ipaFile,
      output: output,
      extracted: extractedDirectory,
      tmp: tmpDirectory
    }
  }

  executeSlicing(configs, cb) {
    const originIpa = configs.ipa;
    const extracted = configs.extracted;
    const tmpDirectory = configs.tmp;

    if (!fileExist(tmpDirectory)) {
      fs.mkdirSync(tmpDirectory);
    }
    // unzip ipa package
    decompress(originIpa, extracted).then(files => {
      console.log('extract success!');

      // slicing
      for (const archKey in this.patchTypes) {
        const scales = this.patchTypes[archKey];
        for (const scaleKey in scales) {
          const scale = scales[scaleKey];
          console.log('processing ' + archKey + ' & ' + scale);
          this.slice(archKey, scale, configs, cb);
        }
      }

      console.log('slicing success!');

      cb(undefined, undefined, undefined, '0')
    }).catch(error => {
      console.log('extract failure!');
      cb(error, undefined, undefined);
    });
  }

  slice(arch, scale, configs, cb) {
    const extracted = configs.extracted;
    const tmpDirectory = configs.tmp;

    const newProductName = arch + '_' + scale;
    const processPath = path.join(tmpDirectory, newProductName);
    fs.copySync(extracted, processPath);

    // remove unnecessary arch
    const allExecuteDirectory = find.dirSync(kExecutePattern, processPath);
    for (const directoryIndex in allExecuteDirectory) {
      const directory = allExecuteDirectory[directoryIndex];
      const appName = path.basename(directory, path.extname(directory));
      const executePath = directory + '/' + appName
      const result = execProgramSync(
        '/usr/bin/lipo'
      , [executePath, '-thin', arch, '-output', executePath]
      , null
      );

      if (result.status != 0) {
        throw result;
      }
    }

    // remove unnecessary images
    const removedList = [];
    const unsupportExtension = [];
    const allResourcesDirectory = find.dirSync(processPath);
    for (const directoryIndex in allResourcesDirectory) {
      const directory = allResourcesDirectory[directoryIndex];
      if (path.basename(directory) == '_CodeSignature') {
        fs.removeSync(directory);
        continue;
      }

      const files = fs.readdirSync(directory).filter(item => { return !isDirectory(path.join(directory, item)) });

      if (allExecuteDirectory.includes(directory)) {
        //  app directory
      } else {
        //  not app directory
        const duplicate = {};
        for (const fileIndex in files ) {
          const fileNameWithExtension = files[fileIndex];
          const fileExtension = path.extname(fileNameWithExtension);
          const fileName = path.basename(fileNameWithExtension, fileExtension);

          if (fileExtension == '') {
            continue;
          }
          
          const lowerCaseFileExtension = fileExtension.toLowerCase();
          if (lowerCaseFileExtension !== '.jpg' && lowerCaseFileExtension !== '.png' && lowerCaseFileExtension !== '.webp' && lowerCaseFileExtension !== '.bmp') {
            if (!unsupportExtension.includes(fileExtension)) {
              unsupportExtension.push(fileExtension);
              console.log('Not support file extension:' + fileExtension);
            }
            continue;
          }

          var realScale = null;
          var realFileName = null;
          const has2x = fileName.endsWith('@2x');
          if (has2x) {
            realScale = '@2x';
            realFileName = fileName.replace('@2x', '');
          }

          const has3x = !has2x && fileName.endsWith('@3x');
          if (has3x) {
            realScale = '@3x';
            realFileName = fileName.replace('@3x', '');
          }

          const has1x = !has2x && !has3x;
          if (has1x) {
            realScale = '@1x';
            realFileName = fileName;
          }
          
          const fileInfo = duplicate[realFileName] || {};
          duplicate[realFileName] = fileInfo;

          const scaleList = fileInfo['scale'] || []
          fileInfo['scale'] = scaleList;
          scaleList.push(realScale)

          const extension = fileInfo['ext'] || fileExtension;
          fileInfo['ext'] = extension;
        }

        // remove other resource
        for (const itemKey in duplicate) {
          const item = duplicate[itemKey];
          const scaleList = item['scale'] || [];
          if (scaleList.length < 2) {
            continue;
          }

          const ext = item['ext'];

          var removedScale = [];
          if (scale == '1x') {
            // handle 1x
            const has1xSuitd = scaleList.includes('@1x');
            const has2xSuitd = !has1xSuitd && scaleList.includes('@2x');
            if (has1xSuitd) {
              removedScale = scaleList.filter( scaleList => { return scaleList != '@1x' });
            } else if (has2xSuitd) {
              removedScale = scaleList.filter( scaleList => { return scaleList != '@2x' });
            } else {
              removedScale = scaleList.filter( scaleList => { return scaleList != '@3x' });
            }
          } else if (scale == '2x') {
            // handle 2x
            const has2xSuitd = scaleList.includes('@2x');
            const has3xSuitd = !has2xSuitd && scaleList.includes('@3x');
            if (has2xSuitd) {
              removedScale = scaleList.filter( scaleList => { return scaleList != '@2x' });
            } else if (has3xSuitd) {
              removedScale = scaleList.filter( scaleList => { return scaleList != '@3x' });
            } else {
              removedScale = scaleList.filter( scaleList => { return scaleList != '@1x' });
            }
          } else if (scale == '3x') {
            // handle 3x
            const has3xSuitd = scaleList.includes('@3x');
            const has2xSuitd = !has3xSuitd && scaleList.includes('@2x');
            if (has3xSuitd) {
              removedScale = scaleList.filter( scaleList => { return scaleList != '@3x' });
            } else if (has2xSuitd) {
              removedScale = scaleList.filter( scaleList => { return scaleList != '@2x' });
            } else {
              removedScale = scaleList.filter( scaleList => { return scaleList != '@1x' });
            }
          }

          removedScale.forEach((item, index, array) => {
            var realFileName = null;
            if (item != '@1x') {
              realFileName = itemKey + item + ext;
            } else {
              realFileName = itemKey + ext;
            }
            const filePath = path.join(directory, realFileName);
            if (fileExist(filePath)) {
              fs.removeSync(filePath);
              removedList.push(filePath);
            }
          });
        }
      }
    }

    // console.log('Delete resource: '+ removedList);

    // resign app
    const content = this.prepareCodeSignContent(extracted, tmpDirectory, cb);
    const developerIdentify = content.developerIdentify;
    const entitlementsPaths = content.entitlementsPaths;
    const keychain = configs.keychain;
    allExecuteDirectory.reverse().forEach((item, index, array) => {
      const productName = path.basename(item, path.extname(item));
      const entitlements = entitlementsPaths[productName];

      const result = execProgramSync(
        '/usr/bin/codesign'
      , ['--continue', '-f', '-s', developerIdentify, '--entitlements', entitlements, '--keychain', keychain, item]
      , null
      );

      if (result.status != 0) {
        throw result;
      }
    });

    // zip to ipa
    const appName = content.appName;
    const output = configs.output;

    if (!fileExist(output)) {
      fs.mkdirSync(output);
    }
    const destPath = path.join(output, newProductName + '.ipa');
    const srcPath = path.join(processPath, '*');

    zipper.sync.zip(processPath).compress().save(destPath);
  }

  prepareCodeSignContent(extractedPath, tmpDirectory, cb) {
    if (this.codesignContent) {
      return this.codesignContent;
    }

    const payloadDirectory = extractedPath + '/Payload';
    const files = fs.readdirSync(payloadDirectory);
    const app = files.find(element => {
      return element.endsWith('.app');
    });

    // app name
    const appName = path.basename(app, '.app');

    // entitlements
    const entitlementsPaths = {};
    const allExecuteDirectory = find.dirSync(kExecutePattern, extractedPath);
    allExecuteDirectory.forEach( (item, index, array) => {
      const productName = path.basename(item, path.extname(item));
      const entitlementsResult = execProgramSync(
        '/usr/bin/codesign'
      , ['-d', '--entitlements', ':-', item]
      , null
      );
      if (entitlementsResult.status != 0) {
        cb(entitlementsResult.stderr.toString(), undefined, undefined);
      }

      const entitlements = entitlementsResult.stdout.toString();
      const entitlementsPath = path.join(tmpDirectory, productName + kEntitlementsSuffix);
      entitlementsPaths[productName] = entitlementsPath;
      fs.writeFileSync(entitlementsPath, entitlements);
    });

    // developerIdentify
    const appPath = path.join(payloadDirectory, appName + '.app');
    const mobileprovisionFilePath = appPath + '/' + 'embedded.mobileprovision';
    const mobileprovisionResult = execProgramSync(
      '/usr/bin/security'
    , ['cms', '-D', '-i', mobileprovisionFilePath]
    , null
    );
    if (mobileprovisionResult.status != 0) {
      cb(mobileprovisionResult.stderr.toString(), undefined, undefined);
    }
    const mobileprovision = mobileprovisionResult.stdout.toString();
    const val = plist.parse(mobileprovision);
    const developerIdentify = 'iPhone Distribution: ' + val.TeamName;

    this.codesignContent = {
      appName: appName,
      entitlementsPaths: entitlementsPaths,
      developerIdentify: developerIdentify
    };
    return this.codesignContent;
  }

  preparePatchTypes() {
    if (this.patchTypes) {
      return this.patchTypes;
    }
    
    // 差分包类型
    this.patchTypes = {
      armv7: [
        '1x',
        '2x'
      ],
      arm64: [
        '2x',
        '3x'
      ]
    }

    return this.patchTypes;
  }
};