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
  "device-list": "deviceList"
};

const authState = async (
  whatsapp: Whatsapp
): Promise<{ state: AuthenticationState; saveState: () => void }> => {
  let creds: AuthenticationCreds;
  let keys: any = {};

  const saveState = async () => {
    try {
      console.log("💾 saveState() chamado para:", whatsapp.name || whatsapp.id);
      console.log("💾 Estado das credenciais:", {
        hasCreds: !!creds,
        hasMe: !!(creds && creds.me),
        meId: creds?.me?.id || "N/A",
        meName: creds?.me?.name || "N/A"
      });
      
      // TEMPORÁRIO: Remover bloqueio de creds.me para diagnóstico
      // Apenas verificar se creds existe
      if (!creds) {
        console.log("⚠️ Sem creds ainda, não salvando sessão.");
        return;
      }
      
      console.log("💾 Salvando sessão...");
      await whatsapp.update({
        session: JSON.stringify({ creds, keys }, BufferJSON.replacer, 0)
      });
      console.log("✅ Sessão salva com sucesso!");
    } catch (error) {
      console.error("❌ Erro ao salvar sessão:", error);
      console.log(error);
    }
  };

  // const getSessionDatabase = await whatsappById(whatsapp.id);

  if (whatsapp.session && whatsapp.session !== null) {
    const result = JSON.parse(whatsapp.session, BufferJSON.reviver);
    creds = result.creds;
    keys = result.keys;
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
          // NÃO salvar aqui - será salvo apenas após connection === "open"
          // Isso evita salvar sessão incompleta durante o handshake
        }
      }
    },
    saveState
  };
};

export default authState;
