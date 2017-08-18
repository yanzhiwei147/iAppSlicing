#!/usr/bin/env node
'use strict';

const packageJson = require('../package.json');
const tools = require('../lib/tools.js');
const conf = require('minimist')(process.argv.slice(2), {
  boolean: [
  ]
});

const SlicingApp = tools.SlicingApp;
const colors = tools.colors;

const options = {
  file: conf._[0] || 'undefined',
  output: conf.output || conf.o,
  identity: conf.identity || conf.i,
  mobileprovision: conf.mobileprovision || conf.m,
  keychain: conf.keychain || conf.k
};

const sa = new SlicingApp(options);
if (conf.version) {
  console.log(packageJson.version);
} else if (conf.h || conf.help || conf._.length === 0) {
  const cmd = process.argv[1].split('/').pop();
  console.error(
`Usage:

  ${cmd} [--options ...] [input-ipafile]

  -k, --keychain [KEYCHAIN]                   Specify alternative keychain file
  -o, --output [output directory]             Directory to the output IPA files
      --version                               Show SlicingApp version
  [input-ipafile]                             Path to the IPA file to slice

Example:

  ${cmd} -k ~/Library/Keychains/login.keychain test-app.ipa
`);
} else {
  console.log(colors.msg("Begin slicing..."));
  sa.slicing( (error, data) => {
    if (error) {
      console.error(error, data);
    }
    console.log(colors.msg("Finish slicing"));

  }).on('message', (msg) => {
    console.log(colors.msg(msg));
  }).on('warning', (msg) => {
    console.warn(colors.warn('warn'), msg);
  }).on('error', (msg) => {
    console.error(colors.msg(msg));
  });
}
