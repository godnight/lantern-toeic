import questions from '../content/questions-v041-part1-twelve.json';
import gate from '../content/questions-v041-part1-twelve-gate.json';
import media from '../content/questions-v041-part1-twelve-media.json';
import type {Part1TwelveInput,Part1TwelvePins} from './listening-part1-12-catalog';
import type {Part1ExtensionPins} from './extend-part1-catalog';

/** Exact private-candidate source and independently fixed pins. Actual image,
 * audio and human-listening checks are separate from compiled admission. */
const sealed:Readonly<{input:Part1TwelveInput;pins:Part1TwelvePins;extensionPins:Part1ExtensionPins}>={
 input:{questions:questions as Part1TwelveInput['questions'],gate:gate as Part1TwelveInput['gate'],media:media as Part1TwelveInput['media']},
 pins:{
  "sourceVersion": "part1-original12-20261122-v1",
  "sourceManifestSha256": "14be8a0e4ed68684c014b12c16aa6470681045e9f1c8ce1a9c0e5d40754d66fe",
  "sourceQuestionsSha256": "cc279c8e50a7ccce4d3f90b0b756b2fcd8acb571d8e82dcafafaa9fa10086e2d",
  "questionsCanonicalSha256": "708d6d89ff3c77a65f8d4efc06e3e78b0ad95d56509f1b833edfca48562a7a8b",
  "gateCanonicalSha256": "255d4cc5bffe249a7476f1884777efdbd26d4563263daa89c5c3c727833d5bfb",
  "mediaCanonicalSha256": "a5dcbc5e6b7eee90a2096c22b0b7082d109260706413c1f42712a694f8f2a98d",
  "base313CanonicalSha256": "040518d008a016afd40c91dcc89af695de637f6455ffdddfa916249d94968592",
  "combined325CanonicalSha256": "f163bf92767a1ebb40ec7baa49e00f15bdfe1c487d4b8606f6ec5a0caaca0049",
  "questionIdPrefix": "v049-p1x12-",
  "imagePathPrefix": "/listening12/",
  "imageExtension": "png",
  "packDescriptor": {
    "admissionBytes": 11452,
    "admissionFileSha256": "f8bfcd86548b37778cf5a4a55e4764248bf15f4866ff9762222c14500aa20b05",
    "admissionPath": "/audio/natural/v040-natural-572f7490ce71/admission.json",
    "clipCount": 12,
    "declaredBytes": 1532160,
    "manifestBytes": 150091,
    "manifestFileSha256": "d98fdf118ceddd926b37e70a52b5765fb3d4ef7eef072d50a52ab399e4bf7b5c",
    "manifestPath": "/audio/natural/v040-natural-572f7490ce71/manifest.json",
    "manifestSha256": "572f7490ce71cac887e169467b6e286a0e66afa2ebee45e36b9802e45b18126b",
    "memberCount": 12,
    "packId": "v040-natural-572f7490ce71"
  }
},
 extensionPins:{
  "base313CanonicalSha256": "040518d008a016afd40c91dcc89af695de637f6455ffdddfa916249d94968592",
  "combined325CanonicalSha256": "f163bf92767a1ebb40ec7baa49e00f15bdfe1c487d4b8606f6ec5a0caaca0049",
  "audioBindingsCanonicalSha256": "799a5ae1be52cf1f127f5d5f9fe77388054f4584b8a8ef56ab033feb5c48195b"
}
};
/** Do not expose or accept changes to the compiled authority. */
export function captureCompiledPart1TwelvePackage(){
 return JSON.parse(JSON.stringify(sealed)) as {input:Part1TwelveInput;pins:Part1TwelvePins;extensionPins:Part1ExtensionPins};
}
