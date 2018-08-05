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
  withLatestFrom,
  throttleTime
} from 'rxjs/operators';
import { MqttClient } from 'mqtt';

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
import { getCropArea } from './squareCrop';
import { ImageRecorder } from './imageRecorder';
import { VelocityTuner } from './velocityTuner';
import { handleKeyEvent } from './keyEventHandler';
import { getMqttClient } from './mqttClient';

import './styles.css';
import './singleplay.css';

const imageSize = 224;
const activeCameraSideSubject = new BehaviorSubject<CameraSide>(
  CameraSide.Left
);
const cropAreaSubject = new BehaviorSubject<Rect | null>(null);

const fullArea = {
  x: 0,
  y: 0,
  width: imageSize,
  height: imageSize
};

let mobilenet: tf.Model;
let mqttClient: MqttClient;
let robotControllerLeft: RobotController;
let robotControllerRight: RobotController;
let classifier: Classifier;
let video: HTMLVideoElement;
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
  let cropArea: Rect;

  switch (cameraSide) {
    case CameraSide.Left:
      side = CameraSide.Left;
      cropArea = cropAreaSubject.value || fullArea;
      break;
    case CameraSide.Right:
      side = CameraSide.Right;
      cropArea = cropAreaSubject.value || fullArea;
      break;
    default:
      throw new Error('camera side is invalid.');
  }
  return captureWithCanvas(destImage, video, side, cropArea);
};

const setupCommandControl = (destImage: HTMLCanvasElement) => {
  const rotateCount = document.querySelector(`.rotate .count`)!;
  const forwardCount = document.querySelector(`.forward .count`)!;
  const backwardCount = document.querySelector(`.backward .count`)!;

  classifier.exampleCounts$.subscribe(([bw, ne, fw]) => {
    backwardCount.textContent = `${bw}`;
    rotateCount.textContent = `${ne}`;
    forwardCount.textContent = `${fw}`;
  });

  const rotateButton = document.querySelector(`.rotate button`)!;
  const forwardButton = document.querySelector(`.forward button`)!;
  const backwardButton = document.querySelector(`.backward button`)!;

  const rotateImage = document.querySelector(
    '.rotate img'
  )! as HTMLImageElement;
  const forwardImage = document.querySelector(
    '.forward img'
  )! as HTMLImageElement;
  const backwardImage = document.querySelector(
    '.backward img'
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

  merge(backPress$, rotatePress$, forwardPress$)
    .pipe(
      map(label => {
        const cameraSide = activeCameraSideSubject.value;
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
      })
    )
    .subscribe(({ label, example }) => {
      classifier.addExample(label, example);
    });

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

const setupLogMessage = () => {
  const logMessage = document.querySelector(`.log-message`)!;
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

const setupCropSelector = (canvas: HTMLCanvasElement) => {
  getCropArea(canvas).subscribe(cropAreaSubject);

  const context = canvas.getContext('2d')!;
  context.strokeStyle = 'rgba(255, 255, 255, 0.7)';
  context.lineWidth = 8;

  cropAreaSubject.subscribe(rect => {
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
  cropAreaSubject: BehaviorSubject<Rect | null>,
  destImage: HTMLCanvasElement,
  video: HTMLVideoElement,
  classifier: Classifier
): Promise<void> {
  const side = activeCameraSideSubject.value;
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
    startWith(true),
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

  const choices = document.querySelectorAll('.cameraside-selector input');
  fromEvent(choices, 'change').subscribe(ev => {
    const elem = ev.target as HTMLInputElement;
    let side: CameraSide;
    switch (elem.value) {
      case 'left':
        side = CameraSide.Left;
        break;
      case 'right':
        side = CameraSide.Right;
        break;
      default:
        throw new Error('camera side is invalid');
    }
    activeCameraSideSubject.next(side);
  });

  video = document.querySelector('.webcam-box video') as HTMLVideoElement;
  const cameraSelector = document.querySelector(
    '#camera-selector'
  ) as HTMLSelectElement;

  await setupCamera({
    targets: [video],
    selector: cameraSelector,
    option: { width: 2 * imageSize, height: imageSize }
  });

  const webcamBox = document.querySelector('.webcam-box')! as HTMLElement;
  activeCameraSideSubject.subscribe(side => {
    switch (side) {
      case CameraSide.Left:
        webcamBox.classList.add('left');
        webcamBox.classList.remove('right');
        break;
      case CameraSide.Right:
        webcamBox.classList.add('right');
        webcamBox.classList.remove('left');
        break;
    }
  });

  const destImage = createDestImage(webcamBox);

  // workaround
  const image = capture(video, CameraSide.Left);
  mobilenet.predict(image);

  const cropSelector = document.querySelector(
    '.webcam-box .crop-selector'
  )! as HTMLCanvasElement;
  setupCropSelector(cropSelector);

  setupCommandControl(destImage);

  const trainButton = document.querySelector('.train')! as HTMLElement;
  const startPredictButton = document.querySelector('.start-predict')!;
  const stopPredictButton = document.querySelector('.stop-predict')!;

  setupTrainButton(classifier, trainButton);

  const trainClick$ = fromEvent(trainButton, 'click');
  const startClick$ = fromEvent(startPredictButton, 'click');
  const stopClick$ = fromEvent(stopPredictButton, 'click');

  trainClick$.subscribe(() => {
    classifier.startTraining().catch(err => console.error(err));
    imageRecorder.recordedImages = [];
  });

  classifier.modelStatus$.subscribe(status => {
    setEnable(startPredictButton, status === ModelStatus.Trained);
  });

  classifier.controlStatus$.subscribe(status => {
    const started = status === ControlStatus.Started;
    startPredictButton.classList.toggle('hidden', started);
    stopPredictButton.classList.toggle('hidden', !started);
  });

  setupLogMessage();

  const predictionInterval$ = startClick$.pipe(
    tap(_ => {
      classifier.setControlStatus(ControlStatus.Started);
    }),
    switchMap(_ => interval(0).pipe(takeUntil(stopClick$))),
    shareReplay()
  );

  predictionInterval$
    .pipe(
      throttleTime(10000), // record image every 10 seconds
      map(_ => destImage.toDataURL())
    )
    .subscribe(imageURL => {
      console.log(imageURL);
      imageRecorder.addImageURLs([imageURL] as [string]);
    });

  predictionInterval$.subscribe(() => {
    predict(cropAreaSubject, destImage, video, classifier).catch(e =>
      console.error(e)
    );
  });

  stopClick$.subscribe(() => {
    robotControllerLeft.setVelocity(0);
    robotControllerRight.setVelocity(0);
    classifier.clearPrediction();
    classifier.setControlStatus(ControlStatus.Stopped);
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

  classifier = new Classifier(false);

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

  classifier.predictionResult$
    .pipe(
      debounceTime(150),
      distinctUntilChanged()
    )
    .subscribe(command => {
      if (command !== null) {
        const [velLeft, velRight] = velocityTuner.getVelocity(command);
        robotControllerLeft.setVelocity(velLeft);
        robotControllerRight.setVelocity(velRight);
      }
    });

  await setupUI();

  classifier.setReady();
})().catch(err => console.error(err));
