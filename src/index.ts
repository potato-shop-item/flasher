// @ts-ignore
import { requestSerialPort } from "./webusb-serial.js";

const baudrates = document.getElementById("baudrates") as HTMLSelectElement;
const connectButton = document.getElementById("connectButton") as HTMLButtonElement;
const disconnectButton = document.getElementById("disconnectButton") as HTMLButtonElement;
const eraseButton = document.getElementById("eraseButton") as HTMLButtonElement;
const programButton = document.getElementById("programButton");
const filesDiv = document.getElementById("files");
const terminal = document.getElementById("terminal");
const programDiv = document.getElementById("program");
const lblBaudrate = document.getElementById("lblBaudrate");
const lblConnTo = document.getElementById("lblConnTo");
const table = document.getElementById("fileTable") as HTMLTableElement;
const alertDiv = document.getElementById("alertDiv");

const debugLogging = document.getElementById("debugLogging") as HTMLInputElement;

import {
  ESPLoader,
  FlashOptions,
  FlashModeValues,
  FlashFreqValues,
  FlashSizeValues,
  LoaderOptions,
  Transport,
} from "../../../lib";
import { serial } from "web-serial-polyfill";

const serialLib = !navigator.serial && navigator.usb ? serial : navigator.serial;

declare let Terminal; 
declare let CryptoJS; 

// 縦幅を15行に固定し、自動改行お任せモードをONにしたターミナル初期化
const term = new Terminal({ 
  cols: 100, 
  rows: 15, 
  convertEol: true 
});
term.open(terminal);

let device = null;
let deviceInfo = null;
let transport: Transport;
let chip: string = null;
let esploader: ESPLoader;

// 初期状態のUI制御
disconnectButton.style.display = "none";
eraseButton.style.display = "none";
filesDiv.style.display = "none";

function handleFileSelect(evt) {
  const file = evt.target.files[0];
  if (!file) return;

  const reader = new FileReader();
  reader.onload = (ev: ProgressEvent<FileReader>) => {
    if (ev.target.result instanceof ArrayBuffer) {
      evt.target.data = new Uint8Array(ev.target.result);
    } else {
      evt.target.data = ev.target.result;
    }
  };
  reader.readAsArrayBuffer(file);
}

const espLoaderTerminal = {
  clean() {
    term.clear();
  },
  writeLine(data) {
    term.writeln(data);
  },
  write(data) {
    term.write(data);
  },
};

function createFileInputRow() {
  const rowCount = table.rows.length;
  const row = table.insertRow(rowCount);

  const cell1 = row.insertCell(0);
  const element1 = document.createElement("input");
  element1.type = "file";
  element1.id = "selectFile" + rowCount;
  element1.name = "selected_File" + rowCount;
  element1.addEventListener("change", handleFileSelect, false);
  cell1.appendChild(element1);

  const cell2 = row.insertCell(1);
  cell2.classList.add("progress-cell");
  cell2.style.display = "none";
  cell2.innerHTML = `<progress value="0" max="100"></progress>`;
}

// ----------------------------------------------------
// 1. Program (書き込み) ロジック
// ----------------------------------------------------
connectButton.onclick = async () => {
  try {
    if (device === null) {
      device = await requestSerialPort(true);
      deviceInfo = device.getInfo();
      transport = new Transport(device, true);
    }
    const flashOptions = {
      transport,
      baudrate: parseInt(baudrates.value),
      terminal: espLoaderTerminal,
      debugLogging: debugLogging.checked,
    } as LoaderOptions;
    esploader = new ESPLoader(flashOptions);

    chip = await esploader.main();

    console.log("Settings done for :" + chip);
    lblBaudrate.style.display = "none";
    lblConnTo.innerHTML = "Connected to device: " + chip;
    lblConnTo.style.display = "block";
    baudrates.style.display = "none";
    connectButton.style.display = "none";
    disconnectButton.style.display = "initial";
    eraseButton.style.display = "initial";
    filesDiv.style.display = "initial";
  } catch (e) {
    console.error(e);
    term.writeln(`Error: ${e.message}`);
  }
};

eraseButton.onclick = async () => {
  eraseButton.disabled = true;
  try {
    await esploader.eraseFlash();
  } catch (e) {
    console.error(e);
    term.writeln(`Error: ${e.message}`);
  } finally {
    eraseButton.disabled = false;
  }
};

function cleanUp() {
  device = null;
  deviceInfo = null;
  transport = null;
  chip = null;
}

disconnectButton.onclick = async () => {
  if (transport) await transport.disconnect();

  term.reset();
  lblBaudrate.style.display = "initial";
  baudrates.style.display = "initial";
  connectButton.style.display = "initial";
  disconnectButton.style.display = "none";
  eraseButton.style.display = "none";
  lblConnTo.style.display = "none";
  filesDiv.style.display = "none";
  alertDiv.style.display = "none";
  cleanUp();
};

// ----------------------------------------------------
// 2. 共通プログラム検証
// ----------------------------------------------------
function validateProgramInputs() {
  const rowCount = table.rows.length;
  let row;
  let fileData = null;

  for (let index = 0; index < rowCount; index++) {
    row = table.rows[index];
    if (!row.cells[0] || !row.cells[0].childNodes[0]) return "No file field available!";
    const fileObj = row.cells[0].childNodes[0] as any;
    fileData = fileObj.data;
    if (fileData == null) return "No file selected!";
  }
  return "success";
}

programButton.onclick = async () => {
  const alertMsg = document.getElementById("alertmsg");
  const err = validateProgramInputs();

  if (err != "success") {
    alertMsg.innerHTML = "<strong>" + err + "</strong>";
    alertDiv.style.display = "block";
    return;
  }

  alertDiv.style.display = "none";
  const fileArray = [];
  const progressBars = [];

  for (let index = 0; index < table.rows.length; index++) {
    const row = table.rows[index];
    const offset = 0; 
    const fileObj = row.cells[0].childNodes[0] as ChildNode & { data: Uint8Array };
    const progressBar = row.cells[1].childNodes[0];

    (progressBar as HTMLProgressElement).value = 0;
    progressBars.push(progressBar);

    row.cells[1].style.display = "initial";
    fileArray.push({ data: fileObj.data, address: offset });
  }

  try {
    const flashOptions: FlashOptions = {
      fileArray: fileArray,
      eraseAll: false,
      compress: true,
      flashMode: "keep" as FlashModeValues, 
      flashFreq: "keep" as FlashFreqValues, 
      flashSize: "keep" as FlashSizeValues, 
      reportProgress: (fileIndex, written, total) => {
        (progressBars[fileIndex] as HTMLProgressElement).value = (written / total) * 100;
      },
      calculateMD5Hash: (image: Uint8Array) => {
        const latin1String = Array.from(image, (byte) => String.fromCharCode(byte)).join("");
        return CryptoJS.MD5(CryptoJS.enc.Latin1.parse(latin1String)).toString();
      },
    };
    await esploader.writeFlash(flashOptions);
    await esploader.after();
  } catch (e) {
    console.error(e);
    term.writeln(`Error: ${e.message}`);
  } finally {
    for (let index = 0; index < table.rows.length; index++) {
      table.rows[index].cells[1].style.display = "none";
    }
  }
};

createFileInputRow();