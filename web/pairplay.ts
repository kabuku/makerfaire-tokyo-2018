import * as tf from '@tensorflow/tfjs';
import {
  combineLatest,
  fromEvent,
  merge,
  interval,
  BehaviorSubject,
  Observable
} from 'rxjs';
import {
  map,
  mapTo,
  switchMap,
  takeUntil,
  debounceTime,
  distinctUntilChanged,
  tap,
  shareReplay,
  withLatestFrom,
  scan,
  startWith,
  filter
} from 'rxjs/operators';

import { RobotController, RobotName } from './robot';
import {
  CameraSide,
  setupCamera,
  capture,
  Rect,
  captureWithCanvas,
  canvasToTensor
} from './camera';
import { Command, Classifier, ModelStatus, ControlStatus } from './classifier';
import { loadMobilenet, createPressStream } from './helper';

import './styles.css';
import './pairplay.css';
import { getCropArea } from './squareCrop';

const imageSize = 224;
const cropAreaLeftSubject = new BehaviorSubject<Rect | null>(null);
const cropAreaRightSubject = new BehaviorSubject<Rect | null>(null);
const fullArea = {
  x: 0,
  y: 0,
  width: imageSize,
  height: imageSize
};
import { ImageRecorder } from './imageRecorder';
import { VelocityTuner } from './velocityTuner';
import { handleKeyEvent } from './keyEventHandler';

let mobilenet: tf.Model;
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

  const neutralCount = document.querySelector(`${side} .neutral .count`)!;
  const forwardCount = document.querySelector(`${side} .forward .count`)!;
  const backwardCount = document.querySelector(`${side} .backward .count`)!;

  classifier.exampleCounts$.subscribe(([bw, ne, fw]) => {
    backwardCount.textContent = `${bw}`;
    neutralCount.textContent = `${ne}`;
    forwardCount.textContent = `${fw}`;
  });

  const neutralButton = document.querySelector(`${side} .neutral button`)!;
  const forwardButton = document.querySelector(`${side} .forward button`)!;
  const backwardButton = document.querySelector(`${side} .backward button`)!;

  const neutralImage = document.querySelector(
    `${side} .neutral img`
  )! as HTMLImageElement;
  const forwardImage = document.querySelector(
    `${side} .forward img`
  )! as HTMLImageElement;
  const backwardImage = document.querySelector(
    `${side} .backward img`
  )! as HTMLImageElement;

  const neutralPress$ = createPressStream(neutralButton).pipe(
    mapTo(Command.Neutral)
  );
  const forwardPress$ = createPressStream(forwardButton).pipe(
    mapTo(Command.Forward)
  );
  const backPress$ = createPressStream(backwardButton).pipe(
    mapTo(Command.Backward)
  );

  merge(backPress$, neutralPress$, forwardPress$)
    .pipe(
      map(label => {
        const image = captureImageWithCanvas(cameraSide, destImage);
        const example = mobilenet.predict(canvasToTensor(image));
        const originalButton =
          label === Command.Neutral
            ? neutralImage
            : label === Command.Forward
              ? forwardImage
              : backwardImage;
        originalButton.src = image.toDataURL();
        return { label, example };
      })
    )
    .subscribe(({ label, example }) => {
      classifier.addExample(label, example);
    });

  const addExampleButtons = [backwardButton, neutralButton, forwardButton];

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

  setupCommandControl(CameraSide.Left, destImageLeft);
  setupCommandControl(CameraSide.Right, destImageRight);

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

  trainLeftClick$.subscribe(() => classifierLeft.startTraining());
  trainRightClick$.subscribe(() => classifierRight.startTraining());

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

  robotNameSelect.value = robotName.value;

  fromEvent<Event>(robotNameSelect, 'change')
    .pipe(map(_ => robotNameSelect.value as RobotName))
    .subscribe(robotName);

  const leftTopic$ = robotName.pipe(map(name => `${name}/left`));
  const rightTopic$ = robotName.pipe(map(name => `${name}/right`));

  [mobilenet, robotControllerLeft, robotControllerRight] = await Promise.all([
    loadMobilenet(),
    RobotController.createInstance(leftTopic$),
    RobotController.createInstance(rightTopic$)
  ]);

  const easyMode = !!Number(new URL(location.href).searchParams.get('easy'));
  classifierLeft = new Classifier(easyMode);
  classifierRight = new Classifier(easyMode);

  const velocityTuner = new VelocityTuner(robotName);
  await handleKeyEvent(robotName, velocityTuner);

  classifierLeft.predictionResult$
    .pipe(
      debounceTime(150),
      distinctUntilChanged()
    )
    .subscribe(command => {
      if (command !== null) {
        robotControllerLeft.setVelocity(
          velocityTuner.getVelocity('left', command)
        );
      }
    });
  classifierRight.predictionResult$
    .pipe(
      debounceTime(150),
      distinctUntilChanged()
    )
    .subscribe(command => {
      if (command !== null) {
        robotControllerRight.setVelocity(
          velocityTuner.getVelocity('right', command)
        );
      }
    });

  await setupUI();

  classifierLeft.setReady();
  classifierRight.setReady();
})().catch(err => console.error(err));
