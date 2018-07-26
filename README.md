# makerfaire-tokyo-2018

[![Build Status](https://travis-ci.org/kabuku/makerfaire-tokyo-2018.svg?branch=master)](https://travis-ci.org/kabuku/makerfaire-tokyo-2018)

## Prerequisite

- Node >= 8.0.0
- npm >= 5.7.0
- Docker

## Setup

```sh
$ npm ci

# load Mobilenet model
$ npm run load-model
```

## Run

```sh
$ npm run web # run Web server
$ npm run mqtt # run MQTT server on Docker

# If you want to subscribe to a topic ('nobunaga/left', for example)
$ npx mqtt sub -t 'nobunaga/left' -h 'localhost'
```

## Dropbox との連携

プレイ画像を共有する機能を有効にするには、 Dropbox との連携が必要です。
https://www.dropbox.com/developers/apps?_tk=pilot_lp&_ad=topbar4&_camp=myapps からアプリを作成し、プロジェクトの直下に `.env` というファイルを作成して以下のような内容を記載してください。 

```
DROPBOX_ACCESS_TOKEN={{ アプリのアクセストークン }}
DROPBOX_FOLDER_NAME={{ プレイ画像を保存するフォルダ }}
```

この機能では、 Dropbox API により、保存したプレイ画像に 4 時間だけアクセス可能な URL が生成され、それが QR コードとして画面上に表示されます。
