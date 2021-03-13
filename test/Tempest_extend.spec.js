const { expect } = require('chai')
const chai = require('chai')
const { Contract, utils, constants } = require ('ethers')
const { solidity, deployContract } = require('ethereum-waffle')
const { waffle } = require ('@nomiclabs/buidler')
const { ecsign } = require('ethereumjs-util')
const { getApprovalDigest } = require('./shared/utilities')

chai.use(solidity)

const INIT_SUPPLY = utils.parseUnits('1000000', 18)
const TEST_AMOUNT = utils.parseUnits('10', 18)

describe('Tempest Extend', () => {
  const [wallet, other, other2] = waffle.provider.getWallets()

  let wardenToken
  let tempest
  let chainId

  beforeEach(async () => {
    wardenToken = await (await ethers.getContractFactory('WardenToken')).deploy()
    tempest = await (await ethers.getContractFactory('Tempest')).deploy(wardenToken.address)
    chainId = (await waffle.provider.getNetwork()).chainId
    await tempest.mint(wallet.address, INIT_SUPPLY)
  })

  it('Should init basic info correctly', async () => {
    const name = await tempest.name()
    expect(name).to.equal('Tempest')
    expect(await tempest.warden()).to.equal(wardenToken.address)
    expect(await tempest.symbol()).to.equal('TST')
    expect(await tempest.decimals()).to.equal(18)
    expect(await tempest.owner()).to.equal(wallet.address)
    expect(await tempest.getOwner()).to.equal(wallet.address)
    expect(await tempest.totalSupply()).to.equal(INIT_SUPPLY)
    expect(await tempest.balanceOf(wallet.address)).to.eq(INIT_SUPPLY)
    expect(await tempest.DOMAIN_TYPEHASH()).to.equal(
      utils.keccak256(
        utils.toUtf8Bytes('EIP712Domain(string name,uint256 chainId,address verifyingContract)')
      )
    )
    expect(await tempest.DELEGATION_TYPEHASH()).to.equal(
      utils.keccak256(
        utils.toUtf8Bytes('Delegation(address delegatee,uint256 nonce,uint256 expiry)')
      )
    )
    expect(await tempest.DOMAIN_SEPARATOR()).to.eq(
      utils.keccak256(
        utils.defaultAbiCoder.encode(
          ['bytes32', 'bytes32', 'bytes32', 'uint256', 'address'],
          [
            utils.keccak256(
              utils.toUtf8Bytes('EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)')
            ),
            utils.keccak256(utils.toUtf8Bytes(name)),
            utils.keccak256(utils.toUtf8Bytes('1')),
            chainId,
            tempest.address
          ]
        )
      )
    )
    expect(await tempest.PERMIT_TYPEHASH()).to.equal(
      utils.keccak256(
        utils.toUtf8Bytes('Permit(address owner,address spender,uint256 value,uint256 nonce,uint256 deadline)')
      )
    )
  })

  it('approve', async () => {
    await expect(tempest.approve(other.address, TEST_AMOUNT))
      .to.emit(tempest, 'Approval')
      .withArgs(wallet.address, other.address, TEST_AMOUNT)
    expect(await tempest.allowance(wallet.address, other.address)).to.eq(TEST_AMOUNT)
  })

  it('transfer', async () => {
    await expect(tempest.transfer(other.address, TEST_AMOUNT))
      .to.emit(tempest, 'Transfer')
      .withArgs(wallet.address, other.address, TEST_AMOUNT)
    expect(await tempest.balanceOf(wallet.address)).to.eq(INIT_SUPPLY.sub(TEST_AMOUNT))
    expect(await tempest.balanceOf(other.address)).to.eq(TEST_AMOUNT)
  })

  it('transfer:fail', async () => {
    await expect(tempest.transfer(other.address, INIT_SUPPLY.add(1)))
    .to.be.revertedWith('ERC20: transfer amount exceeds balance')
    await expect(tempest.connect(other).transfer(wallet.address, 1))
    .to.be.revertedWith('ERC20: transfer amount exceeds balance')
  })

  it('transferFrom', async () => {
    await tempest.approve(other.address, TEST_AMOUNT)
    await expect(tempest.connect(other).transferFrom(wallet.address, other.address, TEST_AMOUNT))
      .to.emit(tempest, 'Transfer')
      .withArgs(wallet.address, other.address, TEST_AMOUNT)
    expect(await tempest.allowance(wallet.address, other.address)).to.eq(0)
    expect(await tempest.balanceOf(wallet.address)).to.eq(INIT_SUPPLY.sub(TEST_AMOUNT))
    expect(await tempest.balanceOf(other.address)).to.eq(TEST_AMOUNT)
  })

  it('transferFrom: max approval', async () => {
    await tempest.approve(other.address, constants.MaxUint256)
    await expect(tempest.connect(other).transferFrom(wallet.address, other.address, TEST_AMOUNT))
      .to.emit(tempest, 'Transfer')
      .withArgs(wallet.address, other.address, TEST_AMOUNT)
    expect(await tempest.allowance(wallet.address, other.address)).to.eq(constants.MaxUint256.sub(TEST_AMOUNT))
    expect(await tempest.balanceOf(wallet.address)).to.eq(INIT_SUPPLY.sub(TEST_AMOUNT))
    expect(await tempest.balanceOf(other.address)).to.eq(TEST_AMOUNT)
  })

  it('permit', async () => {
    const nonce = await tempest.nonces(wallet.address)
    const deadline = constants.MaxUint256
    const digest = await getApprovalDigest(
      tempest,
      { owner: wallet.address, spender: other.address, value: TEST_AMOUNT },
      nonce,
      deadline,
      chainId
    )

    const { v, r, s } = ecsign(Buffer.from(digest.slice(2), 'hex'), Buffer.from(wallet.privateKey.slice(2), 'hex'))

    await expect(tempest.connect(other2).permit(wallet.address, other.address, TEST_AMOUNT, deadline, v, utils.hexlify(r), utils.hexlify(s)))
      .to.emit(tempest, 'Approval')
      .withArgs(wallet.address, other.address, TEST_AMOUNT)
    expect(await tempest.allowance(wallet.address, other.address)).to.eq(TEST_AMOUNT)
    expect(await tempest.nonces(wallet.address)).to.eq('1')
  })
})
