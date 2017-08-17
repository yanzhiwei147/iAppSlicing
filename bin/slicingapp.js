#!/usr/bin/env node
'use strict';

const packageJson = require('../package.json');
const colors = require('colors');
const SlicingApp = require('../lib/tools.js');
const conf = require('minimist')(process.argv.slice(2), {
  boolean: [
  ]
});

const options = {
  file: conf._[0] || 'undefined',
  output: conf.output || conf.o,
  identity: conf.identity || conf.i,
  mobileprovision: conf.mobileprovision || conf.m,
  keychain: conf.keychain || conf.k
};

colors.setTheme({
  error: 'red',
  warn: 'green',
  msg: 'yellow'
});

const sa = new SlicingApp(options);
if (conf.version) {
  console.log(packageJson.version);
} else if (conf.h || conf.help || conf._.length === 0) {
  const cmd = process.argv[1].split('/').pop();
  console.error(
`Usage:

  ${cmd} [--options ...] [input-ipafile]

  -i, --identity [iPhone Distribution:xxx]    Specify Common name to use
  -k, --keychain [KEYCHAIN]                   Specify alternative keychain file
  -m, --mobileprovision [FILE]                Specify the mobileprovision file to use
  -o, --output [output directory]             Directory to the output IPA files
      --version                               Show SlicingApp version
  [input-ipafile]                             Path to the IPA file to slice

Example:

  ${cmd} -i "iPhone Distribution:xxx" -k ~/Library/Keychains/login.keychain test-app.ipa
`);
} else {
  console.log(colors.msg("Begin slicing..."));
  sa.resign( (error, data) => {
    if (error) {
      console.error(error, data);
    }
    console.log(colors.msg("Finish slicing..."));

  }).on('message', (msg) => {
    console.log(colors.msg(msg));
  }).on('warning', (msg) => {
    console.warn(colors.warn('warn'), msg);
  }).on('error', (msg) => {
    console.error(colors.msg(msg));
  });
}
