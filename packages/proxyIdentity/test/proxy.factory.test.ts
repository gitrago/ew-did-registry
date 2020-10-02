import { Contract, providers, ContractFactory } from 'ethers';
import { JsonRpcProvider } from 'ethers/providers';
import { expect } from 'chai';
import { abi as abi1056, bytecode as bytecode1056 } from '../build/contracts/ERC1056.json';
import { abi as abi1155, bytecode as bytecode1155 } from '../build/contracts/ERC1155Multiproxy.json';
import { abi as proxyAbi } from '../build/contracts/ProxyIdentity.json';
import { abi as proxyFactoryAbi, bytecode as proxyFactoryBytecode } from '../build/contracts/ProxyFactory.json';

describe('[PROXY IDENTITY PACKAGE/PROXY FACTORY CONTRACT]', function () {
  this.timeout(0);
  let erc1056: Contract;
  let erc1155: Contract;
  let proxyFactory: Contract;
  const provider = new JsonRpcProvider('http://localhost:8544');
  const deployer: providers.JsonRpcSigner = provider.getSigner(0);
  let deployerAddress: string;
  const proxyFactoryCreator = new ContractFactory(proxyFactoryAbi, proxyFactoryBytecode, deployer);
  const erc1056Factory = new ContractFactory(abi1056, bytecode1056, deployer);
  const erc1155Factory = new ContractFactory(abi1155, bytecode1155, deployer);

  beforeEach(async () => {
    deployerAddress = await deployer.getAddress();
    erc1056 = await (await erc1056Factory.deploy()).deployed();
    erc1155 = await (await erc1155Factory.deploy()).deployed();
    proxyFactory = await (await proxyFactoryCreator.deploy(erc1056.address, erc1155.address)).deployed();
  });

  it('create() should set sender as owner of created proxy and proxyFactory as creator', (done) => {
    proxyFactory.on('ProxyCreated', (proxyAddress: string) => {
      proxyFactory.removeAllListeners('ProxyCreated');
      const proxy = new Contract(proxyAddress, proxyAbi, deployer);
      proxy.owner()
        .then((proxyOwner: string) => {
          expect(proxyOwner).equal(deployerAddress);
          return proxy.creator()
        })
        .then((creator: string) => {
          expect(creator).equal(proxyFactory.address);
          done();
        })
        .catch((e: Error) => {
          expect.fail(e.message);
        });
    });
    const uid = 123;
    proxyFactory.create(uid)
      .then((tx: any) => {
        tx.wait();
      });
  });
});
