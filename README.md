# makerfaire-tokyo-2018

[![Build Status](https://travis-ci.org/kabuku/makerfaire-tokyo-2018.svg?branch=master)](https://travis-ci.org/kabuku/makerfaire-tokyo-2018)

## Prerequisite

- Node >= 8.0.0
- npm >= 5.7.0
- Docker

## Setup

```sh
$ npm ci
```

## Run

```sh
$ npm run web # run Web server
$ npm run mqtt # run MQTT server on Docker

# If you want to subscribe to a topic ('nobunaga/left', for example)
$ npx mqtt sub -t 'nobunaga/left' -h 'localhost'
```
