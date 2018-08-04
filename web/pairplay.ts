import * as tf from '@tensorflow/tfjs';
import {
  BehaviorSubject,
  combineLatest,
  fromEvent,
  interval,
  merge,
  Observable
} from 'rxjs';
import {
  debounceTime,
  distinctUntilChanged,
  filter,
  map,
  mapTo,
  scan,
  shareReplay,
  startWith,
  switchMap,
  takeUntil,
  tap,
  withLatestFrom
} from 'rxjs/operators';

import { observeConnection, RobotController, RobotName } from './robot';
import {
  CameraSide,
  canvasToTensor,
  capture,
  captureWithCanvas,
  Rect,
  setupCamera
} from './camera';
import { Classifier, Command, ControlStatus, ModelStatus } from './classifier';
import { createPressStream, loadMobilenet } from './helper';

import './styles.css';
import './pairplay.css';
import { getCropArea } from './squareCrop';
import { ImageRecorder } from './imageRecorder';
import { VelocityTuner } from './velocityTuner';
import { handleKeyEvent } from './keyEventHandler';

const imageSize = 224;
const cropAreaLeftSubject = new BehaviorSubject<Rect | null>(null);
const cropAreaRightSubject = new BehaviorSubject<Rect | null>(null);
const fullArea = {
  x: 0,
  y: 0,
  width: imageSize,
  height: imageSize
};
import { getMqttClient } from './mqttClient';
import { MqttClient } from 'mqtt';

let mobilenet: tf.Model;
let mqttClient: MqttClient;
let robotControllerLeft: RobotController;
let robotControllerRight: RobotController;
let classifierLeft: Classifier;
let classifierRight: Classifier;
let videoLeft: HTMLVideoElement;
let videoRight: HTMLVideoElement;
let imageRecorder: ImageRecorder;

const setEnable = (elem: Element, enabled: boolean) => {
  if (enabled) {
    elem.removeAttribute('disabled');
  } else {
    elem.setAttribute('disabled', 'true');
  }
};

const captureImageWithCanvas = (
  cameraSide: CameraSide,
  destImage: HTMLCanvasElement
): HTMLCanvasElement => {
  let side: CameraSide;
  let video: HTMLVideoElement;
  let cropArea: Rect;

  switch (cameraSide) {
    case CameraSide.Left:
      side = CameraSide.Left;
      video = videoLeft;
      cropArea = cropAreaLeftSubject.value || fullArea;
      break;
    case CameraSide.Right:
      side = CameraSide.Right;
      video = videoRight;
      cropArea = cropAreaRightSubject.value || fullArea;
      break;
    default:
      throw new Error('camera side is invalid.');
  }
  return captureWithCanvas(destImage, video, side, cropArea);
};

const setupCommandControl = (
  cameraSide: CameraSide,
  destImage: HTMLCanvasElement
) => {
  let side: string;
  let classifier: Classifier;

  switch (cameraSide) {
    case CameraSide.Left:
      side = '.left';
      classifier = classifierLeft;
      break;
    case CameraSide.Right:
      side = '.right';
      classifier = classifierRight;
      break;
    default:
      throw new Error('camera side is invalid.');
  }

  const rotateCount = document.querySelector(`${side} .rotate .count`)!;
  const forwardCount = document.querySelector(`${side} .forward .count`)!;
  const backwardCount = document.querySelector(`${side} .backward .count`)!;

  classifier.exampleCounts$.subscribe(([bw, ro, fw]) => {
    backwardCount.textContent = `${bw}`;
    rotateCount.textContent = `${ro}`;
    forwardCount.textContent = `${fw}`;
  });

  const rotateButton = document.querySelector(`${side} .rotate button`)!;
  const forwardButton = document.querySelector(`${side} .forward button`)!;
  const backwardButton = document.querySelector(`${side} .backward button`)!;

  const rotateImage = document.querySelector(
    `${side} .rotate img`
  )! as HTMLImageElement;
  const forwardImage = document.querySelector(
    `${side} .forward img`
  )! as HTMLImageElement;
  const backwardImage = document.querySelector(
    `${side} .backward img`
  )! as HTMLImageElement;

  const rotatePress$ = createPressStream(rotateButton).pipe(
    mapTo(Command.Rotate)
  );
  const forwardPress$ = createPressStream(forwardButton).pipe(
    mapTo(Command.Forward)
  );
  const backPress$ = createPressStream(backwardButton).pipe(
    mapTo(Command.Backward)
  );

  const addExampleButtons = [backwardButton, rotateButton, forwardButton];

  classifier.predictionResult$.subscribe(result => {
    addExampleButtons.forEach(b => b.removeAttribute('predicted'));

    if (result !== null) {
      const button = addExampleButtons[result];
      button.setAttribute('predicted', 'true');
    }
  });

  classifier.modelStatus$
    .pipe(
      map(
        status =>
          status !== ModelStatus.Preparing && status !== ModelStatus.Training
      )
    )
    .subscribe(trainable =>
      addExampleButtons.forEach(button =>
        setEnable(
          button,
          trainable && !(classifier.easyMode && button === backwardButton)
        )
      )
    );

  return {
    trigger: merge(backPress$, rotatePress$, forwardPress$),
    map: (label: Command) => {
      const image = captureImageWithCanvas(cameraSide, destImage);
      const example = mobilenet.predict(canvasToTensor(image));
      const originalButton =
        label === Command.Rotate
          ? rotateImage
          : label === Command.Forward
            ? forwardImage
            : backwardImage;
      originalButton.src = image.toDataURL();
      return { label, example };
    }
  };
};

const setupTrainButton = (classifier: Classifier, trainButton: HTMLElement) => {
  classifier.modelStatus$
    .pipe(
      map(
        status =>
          status !== ModelStatus.Preparing && status !== ModelStatus.Training
      ),
      withLatestFrom(classifier.controlStatus$)
    )
    .subscribe(([trainable, controlStatus]) => {
      setEnable(
        trainButton,
        trainable && controlStatus === ControlStatus.Stopped
      );
    });
};

const setupLogMessage = (cameraSide: CameraSide) => {
  let side: string;
  let classifier: Classifier;
  switch (cameraSide) {
    case CameraSide.Left:
      side = '.left';
      classifier = classifierLeft;
      break;
    case CameraSide.Right:
      side = '.right';
      classifier = classifierRight;
      break;
    default:
      throw new Error('camera side is invalid.');
  }

  const logMessage = document.querySelector(`.log-message${side}`)!;
  const status$ = classifier.modelStatus$;
  const lossRate$ = classifier.lossRate$;

  combineLatest(status$, lossRate$).subscribe(([status, lossRate]) => {
    let message = '';
    let loss = lossRate || 0;

    switch (status) {
      case ModelStatus.Preparing:
        message = 'Prepareing...';
        break;
      case ModelStatus.Training:
        if (loss) {
          message = `Training: Loss = ${loss.toFixed(5)}`;
        }
        break;
      case ModelStatus.Trained:
        if (loss) {
          message = `Done: Loss = ${loss.toFixed(5)}`;
        }
        break;
    }
    logMessage.textContent = message;
  });
};

const setupCropSelector = (
  canvas: HTMLCanvasElement,
  cameraSide: CameraSide
) => {
  let subject;
  switch (cameraSide) {
    case CameraSide.Left:
      subject = cropAreaLeftSubject;
      break;
    case CameraSide.Right:
      subject = cropAreaRightSubject;
      break;
    default:
      throw new Error(`camera side ${cameraSide} is invalid`);
  }

  getCropArea(canvas).subscribe(subject);

  const context = canvas.getContext('2d')!;
  context.strokeStyle = 'rgb(234, 11, 141)';

  subject.subscribe(rect => {
    context.clearRect(0, 0, canvas.clientWidth, canvas.clientHeight);
    if (rect !== null) {
      const { x, y, width, height } = rect;
      context.strokeRect(x, y, width, height);
    }
  });
};

const createDestImage = (parentElement: HTMLElement): HTMLCanvasElement => {
  const destImage = document.createElement('canvas');
  destImage.width = imageSize;
  destImage.height = imageSize;
  destImage.style.visibility = 'invisible';
  parentElement.appendChild(destImage);
  return destImage;
};

async function predict(
  side: CameraSide,
  cropAreaSubject: BehaviorSubject<Rect | null>,
  destImage: HTMLCanvasElement,
  video: HTMLVideoElement,
  classifier: Classifier
): Promise<void> {
  const srcRect = cropAreaSubject.value || fullArea;
  const image = captureWithCanvas(destImage, video, side, srcRect);
  await classifier.predict(canvasToTensor(image), mobilenet);
}

const changeTheme = (isDark: boolean) => {
  const root = document.querySelector('#root')!;
  if (isDark) {
    root.classList.add('dark');
  } else {
    root.classList.remove('dark');
  }
};

const setupThemeToggle = () => {
  const themeToggleSwitch = document.querySelector('.theme-toggle input')!;
  const themeToggle = document.querySelector('.theme-toggle')!;

  const checked$: Observable<boolean> = fromEvent(
    themeToggleSwitch,
    'click'
  ).pipe(
    startWith(false),
    scan((acc, _) => !acc),
    shareReplay()
  );

  checked$.subscribe(isChecked => {
    if (isChecked) {
      themeToggle.classList.add('theme-checked');
    } else {
      themeToggle.classList.remove('theme-checked');
    }
    changeTheme(isChecked);
  });
};

const setupUI = async () => {
  setupThemeToggle();

  // setup modals

  const modalContainer = document.querySelector('.modal-container')!;
  const outsideClick$ = fromEvent(modalContainer, 'click');

  const escapePressed$ = fromEvent<KeyboardEvent>(window, 'keydown').pipe(
    filter(ev => ev.key === 'Escape')
  );

  // image recording
  imageRecorder = new ImageRecorder(imageSize);

  const recordedImagesModal = document.querySelector('.modal-recorded-images')!;
  const showRecordsButton = document.querySelector('.show-records')!;
  const openRecords$ = fromEvent(showRecordsButton, 'click').pipe(
    tap(ev => ev.preventDefault()),
    mapTo(true)
  );

  merge(
    openRecords$.pipe(mapTo(true)),
    outsideClick$.pipe(mapTo(false)),
    escapePressed$.pipe(mapTo(false))
  )
    .pipe(startWith(false))
    .subscribe(isOpen => {
      if (isOpen) {
        recordedImagesModal.classList.add('active');
        modalContainer.classList.add('active');
        imageRecorder.displayImages();
      } else {
        recordedImagesModal.classList.remove('active');
        modalContainer.classList.remove('active');
      }
    });

  // settings
  const settingsModal = document.querySelector('.modal-settings-content')!;
  const settingsButton = document.querySelector('.header .settings')!;

  merge(
    fromEvent(settingsButton, 'click').pipe(mapTo(true)),
    outsideClick$.pipe(mapTo(false)),
    escapePressed$.pipe(mapTo(false))
  )
    .pipe(startWith(false))
    .subscribe(isOpen => {
      if (isOpen) {
        settingsModal.classList.add('active');
        modalContainer.classList.add('active');
      } else {
        settingsModal.classList.remove('active');
        modalContainer.classList.remove('active');
      }
    });

  [settingsModal, recordedImagesModal].forEach(elem => {
    elem.addEventListener('click', ev => ev.stopImmediatePropagation());
  });

  videoLeft = document.querySelector(
    '.webcam-box.left video'
  ) as HTMLVideoElement;

  videoRight = document.querySelector(
    '.webcam-box.right video'
  ) as HTMLVideoElement;

  const cameraSelector = document.querySelector(
    '#camera-selector'
  ) as HTMLSelectElement;

  await setupCamera({
    targets: [videoLeft, videoRight],
    selector: cameraSelector,
    option: { width: 2 * imageSize, height: imageSize }
  });

  const webcamBoxLeft = document.querySelector(
    '.webcam-box.left'
  )! as HTMLElement;
  const webcamBoxRight = document.querySelector(
    '.webcam-box.right'
  )! as HTMLElement;

  const destImageLeft = createDestImage(webcamBoxLeft);
  const destImageRight = createDestImage(webcamBoxRight);

  // workaround
  const image = capture(videoLeft, CameraSide.Left);
  mobilenet.predict(image);

  const cropSelectorLeft = document.querySelector(
    '.webcam-box.left .crop-selector'
  )! as HTMLCanvasElement;
  const cropSelectorRight = document.querySelector(
    '.webcam-box.right .crop-selector'
  )! as HTMLCanvasElement;

  setupCropSelector(cropSelectorLeft, CameraSide.Left);
  setupCropSelector(cropSelectorRight, CameraSide.Right);

  const { trigger: leftTrigger, map: leftMap } = setupCommandControl(
    CameraSide.Left,
    destImageLeft
  );
  const { trigger: rightTrigger, map: rightMap } = setupCommandControl(
    CameraSide.Right,
    destImageRight
  );
  merge(leftTrigger, rightTrigger)
    .pipe(map(label => [leftMap(label), rightMap(label)]))
    .subscribe(
      ([
        { label: leftLabel, example: leftExample },
        { label: rightLabel, example: rightExample }
      ]) => {
        classifierLeft.addExample(leftLabel, leftExample);
        classifierRight.addExample(rightLabel, rightExample);
      }
    );

  const trainLeftButton = document.querySelector('.train-left')! as HTMLElement;
  const trainRightButton = document.querySelector(
    '.train-right'
  )! as HTMLElement;

  const startPredictButton = document.querySelector('.start-predict')!;
  const stopPredictButton = document.querySelector('.stop-predict')!;

  setupTrainButton(classifierLeft, trainLeftButton);
  setupTrainButton(classifierRight, trainRightButton);

  const trainLeftClick$ = fromEvent(trainLeftButton, 'click');
  const trainRightClick$ = fromEvent(trainRightButton, 'click');
  const startClick$ = fromEvent(startPredictButton, 'click');
  const stopClick$ = fromEvent(stopPredictButton, 'click');

  trainLeftClick$.subscribe(() => {
    classifierLeft.startTraining().catch(err => console.error(err));
    imageRecorder.recordedImages = [];
  });
  trainRightClick$.subscribe(() => {
    classifierRight.startTraining().catch(err => console.error(err));
    imageRecorder.recordedImages = [];
  });

  combineLatest(
    classifierLeft.modelStatus$,
    classifierRight.modelStatus$
  ).subscribe(([left, right]) => {
    const canStartPredict =
      left === ModelStatus.Trained && right === ModelStatus.Trained;
    setEnable(startPredictButton, canStartPredict);
  });

  combineLatest(
    classifierLeft.controlStatus$,
    classifierRight.controlStatus$
  ).subscribe(([left, right]) => {
    const started =
      left === ControlStatus.Started && right === ControlStatus.Started;
    startPredictButton.classList.toggle('hidden', started);
    stopPredictButton.classList.toggle('hidden', !started);
  });

  setupLogMessage(CameraSide.Left);
  setupLogMessage(CameraSide.Right);

  const predictionInterval$ = startClick$.pipe(
    tap(_ => {
      classifierLeft.setControlStatus(ControlStatus.Started);
      classifierRight.setControlStatus(ControlStatus.Started);
    }),
    switchMap(_ => interval(100).pipe(takeUntil(stopClick$))),
    shareReplay()
  );

  predictionInterval$
    .pipe(
      filter(clock => clock % 100 === 0), // record image every 10 seconds
      map(_ =>
        [destImageLeft, destImageRight].map(canvas => canvas.toDataURL())
      )
    )
    .subscribe(imageURLs => {
      imageRecorder.addImageURLs(imageURLs as [string, string]);
    });

  predictionInterval$.subscribe(() => {
    predict(
      CameraSide.Left,
      cropAreaLeftSubject,
      destImageLeft,
      videoLeft,
      classifierLeft
    ).catch(e => console.error(e));
    predict(
      CameraSide.Right,
      cropAreaRightSubject,
      destImageRight,
      videoRight,
      classifierRight
    ).catch(e => console.error(e));
  });

  stopClick$.subscribe(() => {
    robotControllerLeft.setVelocity(0);
    robotControllerRight.setVelocity(0);
    classifierLeft.clearPrediction();
    classifierRight.clearPrediction();
    classifierLeft.setControlStatus(ControlStatus.Stopped);
    classifierRight.setControlStatus(ControlStatus.Stopped);
  });
};

(async () => {
  const robotName = new BehaviorSubject(RobotName.Nobunaga);
  const robotNameSelect = document.querySelector(
    '.robot-name'
  ) as HTMLSelectElement;

  const fragment = document.createDocumentFragment();
  Object.keys(RobotName).forEach(key => {
    const option = document.createElement('option');
    option.value = RobotName[key];
    option.text = key;
    fragment.appendChild(option);
  });
  robotNameSelect.appendChild(fragment);
  robotNameSelect.size = robotNameSelect.children.length;

  robotNameSelect.value = robotName.value;

  fromEvent<Event>(robotNameSelect, 'change')
    .pipe(map(_ => robotNameSelect.value as RobotName))
    .subscribe(robotName);

  const leftTopic$ = robotName.pipe(map(name => `${name}/left`));
  const rightTopic$ = robotName.pipe(map(name => `${name}/right`));

  [mobilenet, mqttClient] = await Promise.all([
    loadMobilenet(),
    getMqttClient()
  ]);

  robotControllerLeft = new RobotController(mqttClient, leftTopic$);
  robotControllerRight = new RobotController(mqttClient, rightTopic$);

  const easyMode = !!Number(new URL(location.href).searchParams.get('easy'));
  classifierLeft = new Classifier(easyMode);
  classifierRight = new Classifier(easyMode);

  const velocityTuner = new VelocityTuner(robotName);
  handleKeyEvent(mqttClient, robotName, velocityTuner);

  observeConnection(mqttClient).subscribe(robots => {
    for (const option of robotNameSelect.children) {
      option.classList.toggle(
        'connected',
        robots.indexOf((option as HTMLOptionElement).value as RobotName) >= 0
      );
    }
  });

  combineLatest(
    [classifierLeft, classifierRight].map(({ predictionResult$ }) =>
      predictionResult$.pipe(debounceTime(150))
    )
  )
    .pipe(
      map(
        ([leftCommand, rightCommand]) =>
          leftCommand !== null &&
          rightCommand !== null &&
          (leftCommand === rightCommand
            ? velocityTuner.getVelocity(leftCommand)
            : [0, 0])
      ),
      filter(Boolean),
      distinctUntilChanged(
        ([left1, right1], [left2, right2]) =>
          left1 === left2 && right1 === right2
      )
    )
    .subscribe(([leftVelocity, rightVelocity]) => {
      console.log(leftVelocity, rightVelocity);
      robotControllerLeft.setVelocity(leftVelocity);
      robotControllerRight.setVelocity(rightVelocity);
    });

  await setupUI();

  classifierLeft.setReady();
  classifierRight.setReady();
})().catch(err => console.error(err));
