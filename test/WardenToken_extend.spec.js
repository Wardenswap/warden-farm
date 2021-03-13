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

describe('WardenToken Extend', () => {
  const [wallet, other, other2] = waffle.provider.getWallets()

  let wardenToken
  let chainId

  beforeEach(async () => {
    wardenToken = await (await ethers.getContractFactory('WardenToken')).deploy()
    chainId = (await waffle.provider.getNetwork()).chainId
    await wardenToken.mint(wallet.address, INIT_SUPPLY)
  })

  it('Should init basic info correctly', async () => {
    const name = await wardenToken.name()
    expect(name).to.equal('WardenSwap Token')
    expect(await wardenToken.symbol()).to.equal('Warden')
    expect(await wardenToken.decimals()).to.equal(18)
    expect(await wardenToken.owner()).to.equal(wallet.address)
    expect(await wardenToken.getOwner()).to.equal(wallet.address)
    expect(await wardenToken.totalSupply()).to.equal(INIT_SUPPLY)
    expect(await wardenToken.balanceOf(wallet.address)).to.eq(INIT_SUPPLY)
    expect(await wardenToken.DOMAIN_TYPEHASH()).to.equal(
      utils.keccak256(
        utils.toUtf8Bytes('EIP712Domain(string name,uint256 chainId,address verifyingContract)')
      )
    )
    expect(await wardenToken.DELEGATION_TYPEHASH()).to.equal(
      utils.keccak256(
        utils.toUtf8Bytes('Delegation(address delegatee,uint256 nonce,uint256 expiry)')
      )
    )
    expect(await wardenToken.DOMAIN_SEPARATOR()).to.eq(
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
            wardenToken.address
          ]
        )
      )
    )
    expect(await wardenToken.PERMIT_TYPEHASH()).to.equal(
      utils.keccak256(
        utils.toUtf8Bytes('Permit(address owner,address spender,uint256 value,uint256 nonce,uint256 deadline)')
      )
    )
  })

  it('approve', async () => {
    await expect(wardenToken.approve(other.address, TEST_AMOUNT))
      .to.emit(wardenToken, 'Approval')
      .withArgs(wallet.address, other.address, TEST_AMOUNT)
    expect(await wardenToken.allowance(wallet.address, other.address)).to.eq(TEST_AMOUNT)
  })

  it('transfer', async () => {
    await expect(wardenToken.transfer(other.address, TEST_AMOUNT))
      .to.emit(wardenToken, 'Transfer')
      .withArgs(wallet.address, other.address, TEST_AMOUNT)
    expect(await wardenToken.balanceOf(wallet.address)).to.eq(INIT_SUPPLY.sub(TEST_AMOUNT))
    expect(await wardenToken.balanceOf(other.address)).to.eq(TEST_AMOUNT)
  })

  it('transfer:fail', async () => {
    await expect(wardenToken.transfer(other.address, INIT_SUPPLY.add(1)))
    .to.be.revertedWith('ERC20: transfer amount exceeds balance')
    await expect(wardenToken.connect(other).transfer(wallet.address, 1))
    .to.be.revertedWith('ERC20: transfer amount exceeds balance')
  })

  it('transferFrom', async () => {
    await wardenToken.approve(other.address, TEST_AMOUNT)
    await expect(wardenToken.connect(other).transferFrom(wallet.address, other.address, TEST_AMOUNT))
      .to.emit(wardenToken, 'Transfer')
      .withArgs(wallet.address, other.address, TEST_AMOUNT)
    expect(await wardenToken.allowance(wallet.address, other.address)).to.eq(0)
    expect(await wardenToken.balanceOf(wallet.address)).to.eq(INIT_SUPPLY.sub(TEST_AMOUNT))
    expect(await wardenToken.balanceOf(other.address)).to.eq(TEST_AMOUNT)
  })

  it('transferFrom: max approval', async () => {
    await wardenToken.approve(other.address, constants.MaxUint256)
    await expect(wardenToken.connect(other).transferFrom(wallet.address, other.address, TEST_AMOUNT))
      .to.emit(wardenToken, 'Transfer')
      .withArgs(wallet.address, other.address, TEST_AMOUNT)
    expect(await wardenToken.allowance(wallet.address, other.address)).to.eq(constants.MaxUint256.sub(TEST_AMOUNT))
    expect(await wardenToken.balanceOf(wallet.address)).to.eq(INIT_SUPPLY.sub(TEST_AMOUNT))
    expect(await wardenToken.balanceOf(other.address)).to.eq(TEST_AMOUNT)
  })

  it('permit', async () => {
    const nonce = await wardenToken.nonces(wallet.address)
    const deadline = constants.MaxUint256
    const digest = await getApprovalDigest(
      wardenToken,
      { owner: wallet.address, spender: other.address, value: TEST_AMOUNT },
      nonce,
      deadline,
      chainId
    )

    const { v, r, s } = ecsign(Buffer.from(digest.slice(2), 'hex'), Buffer.from(wallet.privateKey.slice(2), 'hex'))

    await expect(wardenToken.connect(other2).permit(wallet.address, other.address, TEST_AMOUNT, deadline, v, utils.hexlify(r), utils.hexlify(s)))
      .to.emit(wardenToken, 'Approval')
      .withArgs(wallet.address, other.address, TEST_AMOUNT)
    expect(await wardenToken.allowance(wallet.address, other.address)).to.eq(TEST_AMOUNT)
    expect(await wardenToken.nonces(wallet.address)).to.eq('1')
  })
})
