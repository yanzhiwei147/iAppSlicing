# iAppSlicing

Slicing ipa file.

## Usage

```sh
Usage:

  ${cmd} [--options ...] [input-ipafile]

  -k, --keychain [KEYCHAIN]                   Specify alternative keychain file
  -o, --output [output directory]             Directory to the output IPA files
      --version                               Show SlicingApp version
  [input-ipafile]                             Path to the IPA file to slice

Example:

  slicingapp -k ~/Library/Keychains/login.keychain test-app.ipa
```

Resign an ipa file with specific identity and mobileprovision:

```sh
slicingapp -k ~/Library/Keychains/login.keychain origin.ipa
```

## API usage

Coming soon.
