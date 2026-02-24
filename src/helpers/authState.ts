import type {
  AuthenticationCreds,
  AuthenticationState,
  SignalDataTypeMap
} from "baileys";
import { BufferJSON, initAuthCreds, proto } from "baileys";
import Whatsapp from "../models/Whatsapp";

const KEY_MAP: { [T in keyof SignalDataTypeMap]: string } = {
  "pre-key": "preKeys",
  session: "sessions",
  "sender-key": "senderKeys",
  "app-state-sync-key": "appStateSyncKeys",
  "app-state-sync-version": "appStateVersions",
  "sender-key-memory": "senderKeyMemory",
  "lid-mapping": "lidMapping",
  "device-list": "deviceList",
  tctoken: "tctoken"
};

const authState = async (
  whatsapp: Whatsapp
): Promise<{ state: AuthenticationState; saveState: () => void }> => {
  let creds: AuthenticationCreds;
  let keys: any = {};
  let persistTimer: NodeJS.Timeout | null = null;
  let dirty = false;

  const persistState = async () => {
    if (!dirty) return;
    dirty = false;
    try {
      await whatsapp.update({
        session: JSON.stringify({ creds, keys }, BufferJSON.replacer, 0)
      });
    } catch (error) {
      console.log(error);
    }
  };

  const saveState = async () => {
    dirty = true;
    if (persistTimer) return;
    persistTimer = setTimeout(async () => {
      persistTimer = null;
      await persistState();
    }, Number(process.env.WBOT_AUTHSTATE_DEBOUNCE_MS || 1200));
  };

  // const getSessionDatabase = await whatsappById(whatsapp.id);

  if (whatsapp.session && whatsapp.session !== null) {
    try {
      const result = JSON.parse(whatsapp.session, BufferJSON.reviver);
      creds = result?.creds || initAuthCreds();
      keys = result?.keys || {};
    } catch (_parseError) {
      creds = initAuthCreds();
      keys = {};
    }
  } else {
    creds = initAuthCreds();
    keys = {};
  }

  return {
    state: {
      creds,
      keys: {
        get: (type, ids) => {
          const key = KEY_MAP[type];
          return ids.reduce((dict: any, id) => {
            let value = keys[key]?.[id];
            if (value) {
              // No Baileys v7, o BufferJSON.reviver já faz a conversão necessária
              // Não precisamos mais converter app-state-sync-key manualmente
              dict[id] = value;
            }
            return dict;
          }, {});
        },
        set: (data: any) => {
          // eslint-disable-next-line no-restricted-syntax, guard-for-in
          for (const i in data) {
            const key = KEY_MAP[i as keyof SignalDataTypeMap];
            keys[key] = keys[key] || {};
            Object.assign(keys[key], data[i]);
          }
          // Persistência com debounce para reduzir I/O em picos de atualização de chaves.
          setImmediate(() => saveState());
        }
      }
    },
    saveState
  };
};

export default authState;
