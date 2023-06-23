
const fetch = require('node-fetch')
import { readFileSync, writeFileSync } from 'fs'
import crypto from "crypto"
import { sleepms, unPrefix0x, readUnsignedTx } from "../src/utils"
import { ContextFile } from './constants'

const accessToken = readFileSync("accessToken", 'utf8');
const gatewayHost = "api.fordefi.com"

export async function sendToForDefi(unsignedTxidFile: string, ctxFile: string): Promise<string> {

    const file = readFileSync(ctxFile, 'utf8');
    const ctx = JSON.parse(file) as ContextFile;

    const vault_id = ctx.vaultId;

    // vaultPublicKey should match public key in contex file
    let vaultPublicKey = await getVaultPublickey(vault_id);
    if (unPrefix0x(ctx.publicKey) != vaultPublicKey) {
        throw Error('public key does not match the vault')
    }

    let txidObj = readUnsignedTx(unsignedTxidFile);
    let hash = txidObj.signatureRequests[0].message;
    let hashBase64 = Buffer.from(hash, 'hex').toString('base64')

    const requestJson = {
        "vault_id": vault_id,
        "signer_type": "api_signer",
        "type": "black_box_signature",
        "details": {
            "format": "hash_binary",
            "hash_binary": hashBase64,
        },
    };

    const requestBody = JSON.stringify(requestJson)
    const path = "/api/v1/transactions"
    const timestamp = new Date().getTime();
    const payload = `${path}|${timestamp}|${requestBody}`;

    const privateKeyFile = "private.pem"
    const secretPem = readFileSync(privateKeyFile, 'utf8');
    const privateKey = crypto.createPrivateKey(secretPem);
    const sign = crypto.createSign('SHA256').update(payload, 'utf8').end();
    const signature1 = sign.sign(privateKey, 'base64');


    let response = await fetch(`https://${gatewayHost}${path}`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            "Authorization": `Bearer ${accessToken}`,
            'X-Timestamp': timestamp,
            'X-Signature': signature1,
        },
        body: requestBody,
    });
    const responseJson = await response.json();
    let txId = responseJson.id;

    // write tx id (to later fetch the signature)
    txidObj.forDefiTxId = txId;
    writeFileSync(`${unsignedTxidFile}.unsignedTx.json`, JSON.stringify(txidObj), "utf8");
    console.log(txId);
    return txId;
}

export async function getSignature(unsignedTxidFile: string): Promise<string> {

    const path = "/api/v1/transactions"

    let txidObj = readUnsignedTx(unsignedTxidFile);
    let id = txidObj.forDefiTxId;

    let responseSignature;

    responseSignature = await fetch(`https://${gatewayHost}${path}/${id}`, {
        method: 'GET',
        headers: {
            "Authorization": `Bearer ${accessToken}`,
        },
    });

    const responseJson = await responseSignature.json();

    let signatureHex;
    try {
        signatureHex = Buffer.from(responseJson.signatures[0].data, 'base64').toString('hex');
      } catch (e) {
        throw Error("Transaction is not signed yet? " + e)
      }

    let signedTxid = {
        signature: signatureHex
    }

    writeFileSync(`${unsignedTxidFile}.signedTx.json`, JSON.stringify(signedTxid), "utf8");

    console.log(JSON.stringify(signedTxid))
    return signatureHex;
}

async function getVaultPublickey(vaultId: string): Promise<string> {

    const path = "/api/v1/vaults"

    let response = await fetch(`https://${gatewayHost}${path}/${vaultId}`, {
        method: 'GET',
        headers: {
            "Authorization": `Bearer ${accessToken}`
        }
    });
    const responseJson = await response.json();

    let pubKey = responseJson.public_key_compressed;

    let pubKeyHex = Buffer.from(pubKey, 'base64').toString('hex');
    console.log(pubKeyHex);

    return pubKeyHex;
}


// sendToForDefi("test1", "ctx.json");

// getSignature("test1");