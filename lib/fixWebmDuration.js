/** @typedef {{ id: number; data: WebmBase }} WebmContainerItem */

const SectionType = {
  Container: "Container",
  Uint: "Uint",
  Float: "Float",
};

/** @type {Record<number, {type: string}>} */
const sections = {
  0x8538067: { type: SectionType.Container },
  0x549a966: { type: SectionType.Container },
  0xad7b1: { type: SectionType.Uint },
  0x489: { type: SectionType.Float },
};

class WebmBase {
  /** @type {Uint8Array | undefined} */
  source;
  /** @type {any} */
  data;

  updateBySource() {}

  /**
   * @param {Uint8Array} source
   */
  setSource(source) {
    this.source = source;
    this.updateBySource();
  }

  updateByData() {}

  /**
   * @param {any} data
   */
  setData(data) {
    this.data = data;
    this.updateByData();
  }

  /**
   * @returns {any}
   */
  getValue() {
    return this.data;
  }

  /**
   * @param {any} value
   */
  setValue(value) {
    this.setData(value);
  }
}

class WebmContainer extends WebmBase {
  /** @type {boolean} */
  isInfinite;
  /** @type {number} */
  offset;

  /**
   * @param {boolean} [isInfinite=false]
   */
  constructor(isInfinite = false) {
    super();
    this.isInfinite = isInfinite;
    this.offset = 0;
  }

  /**
   * @returns {number}
   */
  readByte() {
    return /** @type {Uint8Array} */ (this.source)[this.offset++];
  }

  /**
   * @returns {number}
   */
  readUint() {
    const firstByte = this.readByte();
    const bytes = 8 - firstByte.toString(2).length;
    let value = firstByte - (1 << (7 - bytes));
    for (let i = 0; i < bytes; i++) {
      value <<= 8;
      value |= this.readByte();
    }
    return value;
  }

  updateBySource() {
    this.data = [];
    let end;
    for (
      this.offset = 0;
      this.offset < /** @type {Uint8Array} */ (this.source).length;
      this.offset = end
    ) {
      const id = this.readUint();
      const { type } = sections[id] ?? {};
      const len = this.readUint();
      end = /** @type {Uint8Array} */ (this.source).length;
      if (len >= 0)
        end = Math.min(this.offset + len, end);
      const data = /** @type {Uint8Array} */ (this.source).slice(
        this.offset,
        end,
      );
      let section;
      switch (type) {
        case SectionType.Container:
          section = new WebmContainer(len < 0);
          break;
        case SectionType.Uint:
          section = new WebmUint();
          break;
        case SectionType.Float:
          section = new WebmFloat();
          break;
        default:
          section = new WebmBase();
          break;
      }
      section.setSource(data);
      this.data.push({ id, data: section });
    }
  }

  /**
   * @param {number} x
   * @param {boolean} [draft=false]
   */
  writeUint(x, draft = false) {
    let bytes;
    for (
      bytes = 1;
      (x < 0 || x >= 1 << (7 * bytes)) && bytes < 8;
      bytes++
    ) {}
    if (!draft) {
      for (let i = 0; i < bytes; i++) {
        /** @type {Uint8Array} */ (this.source)[this.offset + i] =
          (x >> (8 * (bytes - 1 - i))) & 0xff;
      }
      /** @type {Uint8Array} */ (this.source)[this.offset] &=
        (1 << (8 - bytes)) - 1;
      /** @type {Uint8Array} */ (this.source)[this.offset] |= 1 << (8 - bytes);
    }
    this.offset += bytes;
  }

  /**
   * @param {boolean} [draft=false]
   * @returns {number}
   */
  writeSections(draft = false) {
    this.offset = 0;
    for (let i = 0; i < this.data.length; i++) {
      const section = this.data[i];
      const content = section.data.source;
      const contentLength = /** @type {Uint8Array} */ (content).length;
      this.writeUint(section.id, draft);
      this.writeUint(
        section.data instanceof WebmContainer && section.data.isInfinite
          ? -1
          : contentLength,
        draft,
      );
      if (!draft) {
        /** @type {Uint8Array} */ (this.source).set(
          /** @type {Uint8Array} */ (content),
          this.offset,
        );
      }
      this.offset += contentLength;
    }
    return this.offset;
  }

  updateByData() {
    const length = this.writeSections(true);
    this.source = new Uint8Array(length);
    this.writeSections();
  }

  /**
   * @param {number} id
   * @returns {WebmBase | null}
   */
  getSectionById(id) {
    for (let i = 0; i < this.data.length; i++) {
      const section = this.data[i];
      if (section.id === id) {
        return section.data;
      }
    }
    return null;
  }
}

class WebmUint extends WebmBase {
  updateBySource() {
    this.data = "";
    for (let i = 0; i < /** @type {Uint8Array} */ (this.source).length; i++) {
      const hex = /** @type {Uint8Array} */ (this.source)[i].toString(16);
      this.data += hex.length % 2 === 1 ? "0" + hex : hex;
    }
  }

  updateByData() {
    const length = this.data.length / 2;
    this.source = new Uint8Array(length);
    for (let i = 0; i < length; i++) {
      const hex = this.data.substring(i * 2, i * 2 + 2);
      /** @type {Uint8Array} */ (this.source)[i] = parseInt(hex, 16);
    }
  }

  /**
   * @returns {number}
   */
  getValue() {
    return parseInt(this.data, 16);
  }

  /**
   * @param {number} value
   */
  setValue(value) {
    const hex = value.toString(16);
    this.setData(hex.length % 2 === 1 ? "0" + hex : hex);
  }
}

class WebmFloat extends WebmBase {
  updateBySource() {
    const byteArray = /** @type {Uint8Array} */ (this.source).slice().reverse();
    const floatArrayType =
      /** @type {Uint8Array} */ (this.source).length === 4
        ? Float32Array
        : Float64Array;
    const floatArray = new floatArrayType(byteArray.buffer);
    this.data = floatArray[0];
  }

  updateByData() {
    const floatArrayType =
      this.source && /** @type {Uint8Array} */ (this.source).length === 4
        ? Float32Array
        : Float64Array;
    const floatArray = new floatArrayType([this.data]);
    const byteArray = new Uint8Array(floatArray.buffer);
    this.source = byteArray.reverse();
  }
}

class WebmFile extends WebmContainer {
  /**
   * @param {Uint8Array} source
   */
  constructor(source) {
    super();
    this.setSource(source);
  }

  /**
   * @param {string} [mimeType="video/webm"]
   * @returns {Blob}
   */
  toBlob(mimeType = "video/webm") {
    return new Blob(
      [/** @type {ArrayBuffer} */ (/** @type {Uint8Array} */ (this.source).buffer)],
      { type: mimeType },
    );
  }

  /**
   * @param {Blob} blob
   * @returns {Promise<WebmFile>}
   */
  static async fromBlob(blob) {
    const array = await new Promise(
      /**
       * @param {(value: Uint8Array) => void} resolve
       * @param {(reason?: any) => void} reject
       */(
        (resolve, reject) => {
          const reader = new FileReader();
          reader.onloadend = () => {
            if (reader.result === null) {
              reject("null");
              return;
            }
            if (typeof reader.result === "string") {
              reject("string");
              return;
            }
            /** @type {ArrayBuffer} */
            const result = reader.result;
            resolve(new Uint8Array(result));
          };
          reader.readAsArrayBuffer(blob);
        }
      ),
    );
    return new WebmFile(array);
  }
}

/**
 * @param {WebmFile} file
 * @param {number} duration
 * @returns {boolean}
 */
function fixParsedWebmDuration(file, duration) {
  const segmentSection = /** @type {WebmContainer | null} */ (file.getSectionById(0x8538067));
  if (!segmentSection) return false;
  const infoSection = /** @type {WebmContainer | null} */ (segmentSection.getSectionById(0x549a966));
  if (!infoSection) return false;
  const timeScaleSection = infoSection.getSectionById(0xad7b1);
  if (!timeScaleSection) return false;

  let durationSection = infoSection.getSectionById(0x489);
  if (durationSection) {
    if (durationSection.getValue() <= 0) {
      durationSection.setValue(duration);
    } else {
      return false;
    }
  } else {
    durationSection = new WebmFloat();
    durationSection.setValue(duration);
    infoSection.data.push({ id: 0x489, data: durationSection });
  }

  timeScaleSection.setValue(1000000);
  infoSection.updateByData();
  segmentSection.updateByData();
  file.updateByData();
  return true;
}

/**
 * @param {Blob} blob
 * @param {number} duration
 * @returns {Promise<Blob>}
 */
export async function fixWebmDuration(blob, duration) {
  try {
    const file = await WebmFile.fromBlob(blob);
    if (fixParsedWebmDuration(file, duration)) {
      return file.toBlob(blob.type);
    }
  } catch {
    // NOOP
  }
  return blob;
}
