import { timingSafeEqual, webcrypto } from 'node:crypto';
import {
  Certificate,
  CryptoEngine,
  ExtKeyUsage,
  SignedData,
  TSTInfo,
  TimeStampResp,
  id_ExtKeyUsage,
  id_eContentType_TSTInfo,
  id_sha256,
  id_sha384,
  id_sha512,
  setEngine,
} from 'pkijs';
import { hashBytes } from './hash.js';

const FREETSA_URL = 'https://freetsa.org/tsr';
const TSQ_PREFIX = Buffer.from('30390201013031300d060960864801650304020105000420', 'hex');
const TSQ_SUFFIX = Buffer.from('0101ff', 'hex');
const TIMESTAMPING_EKU = '1.3.6.1.5.5.7.3.8';
const SHA1_OID = '1.3.14.3.2.26';

const FREETSA_ROOT_FINGERPRINT = 'a6379e7cecc05faa3cbf076013d745e327bbbaa38c0b9af22469d4701d18aabc';
const FREETSA_SIGNER_FINGERPRINTS = new Set([
  '4694be23c3a53004444b1705bfe5a7f50a6d2a1638194f23c0f389b68bd78a75',
  '32e841a95cc1164101ffde41298ef2fc75c1c4372ef095e88a6bbd47dfb191fc',
]);

const DIGEST_LENGTH_BY_OID = new Map([
  [SHA1_OID, 20],
  [id_sha256, 32],
  [id_sha384, 48],
  [id_sha512, 64],
]);

const nodeEngine = new CryptoEngine({
  name: 'node',
  crypto: webcrypto as never,
  subtle: webcrypto.subtle as never,
});
setEngine('node', nodeEngine);

export interface TimestampValidationResult {
  valid: boolean;
  tsaTime: Date | null;
  reason?: string;
}

interface TimestampResponse {
  ok: boolean;
  status: number;
  arrayBuffer(): Promise<ArrayBuffer>;
}

type TimestampFetch = (
  url: string,
  init: {
    method: 'POST';
    headers: Record<string, string>;
    body: ArrayBuffer;
  },
) => Promise<TimestampResponse>;

function toArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
}

function buildTimestampQuery(sha256Hex: string): Buffer {
  if (!/^[a-f0-9]{64}$/i.test(sha256Hex)) {
    throw new Error('Timestamp requests require a SHA-256 hex digest');
  }

  return Buffer.concat([TSQ_PREFIX, Buffer.from(sha256Hex, 'hex'), TSQ_SUFFIX]);
}

export async function requestTimestamp(
  sha256Hex: string,
  fetchImpl: TimestampFetch = (url, init) => fetch(url, init),
): Promise<string> {
  const response = await fetchImpl(FREETSA_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/timestamp-query',
      Accept: 'application/timestamp-reply',
    },
    body: toArrayBuffer(buildTimestampQuery(sha256Hex)),
  });
  if (!response.ok) throw new Error(`FreeTSA responded ${response.status.toString()}`);

  return Buffer.from(await response.arrayBuffer()).toString('base64');
}

function certificateFingerprint(certificate: Certificate): string {
  return hashBytes(new Uint8Array(certificate.toSchema(true).toBER(false)));
}

function hasTimestampingExtendedKeyUsage(certificate: Certificate): boolean {
  const extension = certificate.extensions?.find((item) => item.extnID === id_ExtKeyUsage);
  if (!extension?.critical || !(extension.parsedValue instanceof ExtKeyUsage)) return false;
  return (
    extension.parsedValue.keyPurposes.length === 1 &&
    extension.parsedValue.keyPurposes[0] === TIMESTAMPING_EKU
  );
}

function invalid(reason: string, tsaTime: Date | null = null): TimestampValidationResult {
  return { valid: false, tsaTime, reason };
}

export async function validateTimestampToken(
  tsrToken: string,
  expectedDigestHex: string,
): Promise<TimestampValidationResult> {
  let tsaTime: Date | null = null;

  try {
    if (!/^(?:[a-f0-9]{2})+$/i.test(expectedDigestHex)) {
      return invalid('expected digest is not valid hexadecimal');
    }

    const responseBytes = Buffer.from(tsrToken, 'base64');
    if (responseBytes.length === 0) return invalid('timestamp reply is empty');

    const response = TimeStampResp.fromBER(toArrayBuffer(responseBytes));
    if (![0, 1].includes(response.status.status)) {
      return invalid(`timestamp authority returned status ${response.status.status.toString()}`);
    }
    if (!response.timeStampToken) return invalid('timestamp reply has no signed token');

    const signedData = new SignedData({ schema: response.timeStampToken.content });
    if (signedData.encapContentInfo.eContentType !== id_eContentType_TSTInfo) {
      return invalid('signed content is not RFC-3161 timestamp information');
    }
    const encodedTstInfo = signedData.encapContentInfo.eContent?.getValue();
    if (!encodedTstInfo) return invalid('timestamp information is missing');

    const tstInfo = TSTInfo.fromBER(encodedTstInfo);
    tsaTime = tstInfo.genTime;

    const digestOid = tstInfo.messageImprint.hashAlgorithm.algorithmId;
    const expectedDigestLength = DIGEST_LENGTH_BY_OID.get(digestOid);
    if (!expectedDigestLength)
      return invalid('timestamp uses an unsupported digest algorithm', tsaTime);

    const expectedDigest = Buffer.from(expectedDigestHex, 'hex');
    const stampedDigest = Buffer.from(tstInfo.messageImprint.hashedMessage.getValue());
    if (
      expectedDigest.length !== expectedDigestLength ||
      stampedDigest.length !== expectedDigestLength ||
      !timingSafeEqual(expectedDigest, stampedDigest)
    ) {
      return invalid('timestamp message imprint does not match the expected digest', tsaTime);
    }

    const certificates = (signedData.certificates ?? []).filter(
      (certificate): certificate is Certificate => certificate instanceof Certificate,
    );
    const trustedRoot = certificates.find(
      (certificate) => certificateFingerprint(certificate) === FREETSA_ROOT_FINGERPRINT,
    );
    if (!trustedRoot) return invalid('timestamp is not rooted in the pinned FreeTSA CA', tsaTime);

    // PKIjs' SignedData helper otherwise asks for the original document bytes
    // and re-checks the imprint. We have already compared that imprint above,
    // so verify the CMS signature and chain over the embedded TSTInfo directly.
    signedData.encapContentInfo.eContentType = SignedData.ID_DATA;
    const verification = await signedData.verify({
      signer: 0,
      checkChain: true,
      trustedCerts: [trustedRoot],
      checkDate: tsaTime,
      extendedMode: true,
    });
    if (!verification.signatureVerified || !verification.signerCertificateVerified) {
      return invalid('timestamp signature or certificate chain is invalid', tsaTime);
    }

    const signerCertificate = verification.signerCertificate;
    if (
      !signerCertificate ||
      !FREETSA_SIGNER_FINGERPRINTS.has(certificateFingerprint(signerCertificate))
    ) {
      return invalid('timestamp signer is not a pinned FreeTSA certificate', tsaTime);
    }
    if (!hasTimestampingExtendedKeyUsage(signerCertificate)) {
      return invalid('timestamp signer certificate is not restricted to timestamping', tsaTime);
    }

    return { valid: true, tsaTime };
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    return invalid(`timestamp reply is malformed or cryptographically invalid: ${detail}`, tsaTime);
  }
}
