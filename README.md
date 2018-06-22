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
$ npm run mqtt # run MQTT server on Docker
$ npm run web # run Web server

# If you want to subscribe to a topic ('nobunaga/left', for example)
$ npx mqtt sub -t 'nobunaga/left' -h 'localhost'
```

## use Navigator.getUserMedia in local http network
- open Chrome with command below ([detail](https://stackoverflow.com/questions/34197653/getusermedia-in-chrome-47-without-using-https/34198101#34198101))  
  `open -a "/Applications/Google Chrome.app" --args --unsafely-treat-insecure-origin-as-secure="http://www.your-local-server.com"`
