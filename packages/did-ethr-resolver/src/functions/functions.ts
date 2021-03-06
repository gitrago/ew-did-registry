/* eslint-disable no-loop-func */
/* eslint-disable no-empty */
import {
  Contract, ethers, providers, utils,
} from 'ethers';

import {
  IDIDDocument,
  IDIDLogData,
  IHandlers,
  IPublicKey,
  IAttributePayload,
  IServiceEndpoint,
  ISmartContractEvent,
  RegistrySettings,
  IAuthentication,
  DocumentSelector,
} from '@ew-did-registry/did-resolver-interface';

import { attributeNamePattern, DIDPattern } from '../constants';

/**
 * This function updates the document if the event type is 'DelegateChange'
 *
 * @param event
 * @param did
 * @param document
 * @param validTo
 * @param block
 */
const handleDelegateChange = (
  event: ISmartContractEvent,
  did: string,
  document: IDIDLogData,
  validTo: utils.BigNumber,
  block: number,
): IDIDLogData => {
  const stringDelegateType = ethers.utils.parseBytes32String(event.values.delegateType);
  const publicKeyID = `${did}#delegate-${stringDelegateType}-${event.values.delegate}`;
  if (document.publicKey[publicKeyID] === undefined
    || document.publicKey[publicKeyID].block < block) {
    switch (stringDelegateType) {
      case 'sigAuth':
        document.authentication[publicKeyID] = {
          type: 'sigAuth',
          publicKey: publicKeyID,
          validity: validTo,
          block,
        };
      // eslint-disable-next-line no-fallthrough
      case 'veriKey':
        document.publicKey[publicKeyID] = {
          id: publicKeyID,
          type: 'Secp256k1VerificationKey2018',
          controller: did,
          ethereumAddress: event.values.delegate,
          validity: validTo,
          block,
        };
        break;
      default:
        break;
    }
  }
  return document;
};

/**
 * This function updates the document on Attribute change event
 *
 * @param event
 * @param did
 * @param document
 * @param validTo
 * @param block
 */
const handleAttributeChange = (
  event: ISmartContractEvent,
  did: string,
  document: IDIDLogData,
  validTo: utils.BigNumber,
  block: number,
): IDIDLogData => {
  const [, identity] = did.match(DIDPattern);
  if (!identity) {
    throw new Error('Invalid DID');
  }
  const attributeType = event.values.name;
  const stringAttributeType = ethers.utils.parseBytes32String(attributeType);
  const match = stringAttributeType.match(attributeNamePattern);
  if (match) {
    const section = match[1];
    const algo = match[2];
    const type = match[4];
    const encoding = match[6];
    switch (section) {
      case 'pub':
        // eslint-disable-next-line no-case-declarations
        let publicKeysPayload: IAttributePayload = null;
        try {
          const parsed = JSON.parse(Buffer.from(event.values.value.slice(2), 'hex').toString());
          if (typeof parsed === 'object') {
            publicKeysPayload = parsed;
          }
        } catch (e) { }
        if (!publicKeysPayload) {
          return document;
        }
        // eslint-disable-next-line no-case-declarations
        const pk: IPublicKey = {
          // method should be defined from did provided
          id: `${did}#${publicKeysPayload.tag}`,
          type: `${algo}${type}`,
          controller: identity,
          validity: validTo,
          block,
        };
        if (document.publicKey[pk.id] === undefined
          || document.publicKey[pk.id].block < block) {
          switch (encoding) {
            case null:
            case undefined:
            case 'hex':
              pk.publicKeyHex = publicKeysPayload.publicKey;
              break;
            case 'base64':
              pk.publicKeyBase64 = Buffer.from(
                event.values.value.slice(2),
                'hex',
              ).toString('base64');
              break;
            case 'pem':
              pk.publicKeyPem = Buffer.from(
                event.values.value.slice(2),
                'hex',
              ).toString();
              break;
            default:
              break;
          }
          document.publicKey[pk.id] = pk;
        }
        return document;
      case 'svc':
        // eslint-disable-next-line no-case-declarations
        const servicePoint: IServiceEndpoint = JSON.parse(Buffer.from(
          event.values.value.slice(2),
          'hex',
        ).toString());

        servicePoint.validity = validTo;
        servicePoint.block = block;

        if (document.service[servicePoint.id] === undefined
          || document.service[servicePoint.id].block < block) {
          document.service[servicePoint.id] = servicePoint;

          return document;
        }
        break;
      default:
        break;
    }
  } else if (document.attributes.get(stringAttributeType) === undefined
    || (document.attributes.get(stringAttributeType)).block < block) {
    const attributeData = {
      attribute: Buffer.from(event.values.value.slice(2), 'hex').toString(),
      validity: validTo,
      block,
    };
    document.attributes.set(stringAttributeType, attributeData);
    return document;
  }
  return document;
};

/**
 * Simply a handler for delegate vs attribute change
 */
const handlers: IHandlers = {
  DIDDelegateChanged: handleDelegateChange,
  DIDAttributeChanged: handleAttributeChange,
};

/**
 * Update document checks the event validity, and, if valid,
 * passes the event parsing to the handler
 *
 * @param event
 * @param eventName
 * @param did
 * @param document
 * @param block
 */
const updateDocument = (
  event: ISmartContractEvent,
  eventName: string,
  did: string,
  document: IDIDLogData,
  block: number,
): IDIDLogData => {
  const { validTo } = event.values;

  if (validTo) {
    const handler = handlers[eventName];
    return handler(event, did, document, validTo, block);
  }

  return document;
};

/**
 * Given a certain block from the chain, this function returns the events
 * associated with the did within the block
 *
 * @param block
 * @param did
 * @param document
 * @param provider
 * @param contractInterface
 * @param address
 */
const getEventsFromBlock = (
  block: ethers.utils.BigNumber,
  did: string,
  document: IDIDLogData,
  provider: ethers.providers.Provider,
  contractInterface: utils.Interface,
  address: string,
): Promise<unknown> => new Promise((resolve, reject) => {
  const [, , identity] = did.split(':');
  const topics = [null, `0x000000000000000000000000${identity.slice(2).toLowerCase()}`];

  provider.getLogs({
    address,
    fromBlock: block.toNumber(),
    toBlock: block.toNumber(),
    topics,
  }).then((log) => {
    const event: ISmartContractEvent = contractInterface.parseLog(log[0]) as ISmartContractEvent;
    const eventName = event.name;
    updateDocument(event, eventName, did, document, block.toNumber());

    resolve(event.values.previousChange);
  }).catch((error) => {
    reject(error);
  });
});

export const query = (
  document: IDIDDocument, selector: DocumentSelector,
): IPublicKey | IServiceEndpoint | IAuthentication => {
  const attrName = Object.keys(selector)[0] as keyof DocumentSelector;
  const attr = Object.values(document[attrName])
    .find((a: IPublicKey | IServiceEndpoint | IAuthentication) => Object
      .entries(selector[attrName])
      .every(([prop, val]) => a[prop] && a[prop] === val));
  return attr;
};

/**
 * A high level function that manages the flow to read data from the blockchain
 *
 * @param did
 * @param document
 * @param registrySettings
 * @param contract
 * @param provider
 */
export const fetchDataFromEvents = async (
  did: string,
  document: IDIDLogData,
  registrySettings: RegistrySettings,
  contract: Contract,
  provider: providers.Provider,
  selector?: DocumentSelector,
): Promise<void> => {
  const [, , identity] = did.split(':');
  let nextBlock;
  let topBlock;
  try {
    nextBlock = await contract.changed(identity);
    topBlock = nextBlock;
  } catch (error) {
    throw new Error('Blockchain address did not interact with smart contract');
  }

  if (nextBlock) {
    document.owner = await contract.owners(identity);
  } else {
    document.owner = identity;
  }

  const contractInterface = new ethers.utils.Interface(registrySettings.abi);
  const { address } = registrySettings;
  while (
    nextBlock.toNumber() !== 0
    && nextBlock.toNumber() >= document.topBlock.toNumber()
  ) {
    // eslint-disable-next-line no-await-in-loop
    nextBlock = await getEventsFromBlock(
      nextBlock,
      did,
      document,
      provider,
      contractInterface,
      address,
    );
    if (selector) {
      const attribute = query(document as unknown as IDIDDocument, selector);
      if (attribute) {
        return;
      }
    }
  }
  document.topBlock = topBlock;
};

/**
 * Provided with the fetched data, the function parses it and returns the
 * DID Document associated with the relevant user
 *
 * @param did
 * @param document
 * @param context
 */
export const wrapDidDocument = (
  did: string,
  document: IDIDLogData,
  context = 'https://www.w3.org/ns/did/v1',
): IDIDDocument => {
  const now = new utils.BigNumber(Math.floor(new Date().getTime() / 1000));

  const publicKey: IPublicKey[] = [
  ];

  const authentication = [
    {
      type: 'owner',
      publicKey: `${did}#owner`,
    },
  ];

  const didDocument: IDIDDocument = {
    '@context': context,
    id: did,
    publicKey,
    authentication,
    service: [],
  };

  // eslint-disable-next-line guard-for-in,no-restricted-syntax
  for (const key in document.publicKey) {
    const pubKey = document.publicKey[key];
    if (pubKey.validity.gt(now)) {
      const pubKeyCopy = { ...pubKey };
      delete pubKeyCopy.validity;
      delete pubKeyCopy.block;
      didDocument.publicKey.push(pubKeyCopy);
    }
  }

  // eslint-disable-next-line guard-for-in,no-restricted-syntax
  for (const key in document.authentication) {
    const authenticator = document.authentication[key];
    if (authenticator.validity.gt(now)) {
      const authenticatorCopy = { ...authenticator };
      delete authenticatorCopy.validity;
      delete authenticatorCopy.block;
      didDocument.authentication.push(authenticatorCopy);
    }
  }

  // eslint-disable-next-line guard-for-in,no-restricted-syntax
  for (const key in document.service) {
    const serviceEndpoint = document.service[key];
    if (serviceEndpoint.validity.gt(now)) {
      const serviceEndpointCopy = { ...serviceEndpoint };
      delete serviceEndpointCopy.validity;
      delete serviceEndpointCopy.block;
      didDocument.service.push(serviceEndpointCopy);
    }
  }

  return didDocument;
};

/**
 * Restore document from partially read logs
 *
 * @param logs {IDIDLogData[]}
 */
export const mergeLogs = (logs: IDIDLogData[]): IDIDLogData => {
  logs = logs.sort((a, b) => a.topBlock.sub(b.topBlock).toNumber());
  return logs.reduce(
    (doc, log) => {
      doc.service = { ...doc.service, ...log.service };

      doc.publicKey = { ...doc.publicKey, ...log.publicKey };

      doc.authentication = { ...doc.authentication, ...log.authentication };

      return doc;
    },
    logs[0],
  );
};

export const documentFromLogs = (did: string, logs: IDIDLogData[]): IDIDDocument => {
  const mergedLogs: IDIDLogData = mergeLogs(logs);

  return wrapDidDocument(did, mergedLogs);
};
