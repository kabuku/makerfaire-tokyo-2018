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

## Face Detection

顔認識は簡易的に、 [Shape Detection API](https://www.chromestatus.com/feature/4757990523535360) により実装されています。
Chrome でこれを利用するには chrome://flags で "Experimental Web Platform features" を有効にする必要があります。

## Google Cloud Storage との連携

プレイ画像を共有する機能を有効にするには、 Google Cloud Storage との連携が必要です。
GCS でバケットを作成したら、本プロジェクトの直下に `.env` というファイルを作成して以下のような内容を記載してください。 

```
GCS_BUCKET_NAME={{ バケット名 }}
```

また、 https://cloud.google.com/docs/authentication/api-keys の手順にしたがってサービスアカウントの API キーを生成し、生成された JSON を本プロジェクトの直下に `google-api-key.json` という名前で保存してください。
