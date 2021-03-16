const { expect } = require('chai')
const chai = require('chai')
const { Contract, utils, constants, BigNumber } = require ('ethers')
const { solidity, deployContract } = require('ethereum-waffle')
const { waffle } = require ('@nomiclabs/buidler')
const { ecsign } = require('ethereumjs-util')
const { getApprovalDigest } = require('./shared/utilities')
const { advanceBlockTo, latest, duration, increase } = require('./utilities/time')
const { encodeParameters } = require('./utilities')

chai.use(solidity)

describe("Timelock", () => {
  const [alice, bob, carol, dev, minter] = waffle.provider.getWallets()

  let MasterChef
  let WardenToken
  let ERC20Mock

  let wardenToken
  let tempest

  let Timelock

  beforeEach(async () => {
    MasterChef = await ethers.getContractFactory("MasterChef")
    WardenToken = await ethers.getContractFactory("WardenToken")
    Tempest = await ethers.getContractFactory("Tempest")
    ERC20Mock = await ethers.getContractFactory("MockERC20", minter)
    Timelock = await ethers.getContractFactory("Timelock")

    wardenToken = await WardenToken.deploy()
    await wardenToken.deployed()

    tempest = await Tempest.deploy(wardenToken.address)
    await tempest.deployed()

    timelock = await Timelock.deploy(bob.address, "259200") // 3 days
    await timelock.deployed()
  })

  it('Should init data correctly', async () => {
    expect(await timelock.GRACE_PERIOD()).to.equal(duration.days(14))
    expect(await timelock.MINIMUM_DELAY()).to.equal(duration.days(1))
    expect(await timelock.MAXIMUM_DELAY()).to.equal(duration.days(30))

    expect(await timelock.admin()).to.equal(bob.address)
    expect(await timelock.pendingAdmin()).to.equal(constants.AddressZero)
    expect(await timelock.delay()).to.equal(duration.days(3))
    expect(await timelock.admin_initialized()).to.equal(false)
  })

  it("should not allow non-owner to do operation", async () => {
    await wardenToken.transferOwnership(timelock.address)

    await expect(wardenToken.transferOwnership(carol.address)).to.be.revertedWith("Ownable: caller is not the owner")
    await expect(wardenToken.connect(bob).transferOwnership(carol.address)).to.be.revertedWith("Ownable: caller is not the owner")

    await expect(
      timelock.queueTransaction(
        wardenToken.address,
        "0",
        "transferOwnership(address)",
        encodeParameters(["address"], [carol.address]),
        (await latest()).add(duration.days(4))
      )
    ).to.be.revertedWith("Timelock::queueTransaction: Call must come from admin.")
  })

  it("should do the timelock thing", async () => {
    await wardenToken.transferOwnership(timelock.address)
    const eta = (await latest()).add(duration.days(4))
    await timelock
      .connect(bob)
      .queueTransaction(wardenToken.address, "0", "transferOwnership(address)", encodeParameters(["address"], [carol.address]), eta)
    await increase(duration.days(1))
    await expect(
      timelock
        .connect(bob)
        .executeTransaction(wardenToken.address, "0", "transferOwnership(address)", encodeParameters(["address"], [carol.address]), eta)
    ).to.be.revertedWith("Timelock::executeTransaction: Transaction hasn't surpassed time lock.")
    await increase(duration.days(4))
    await timelock
      .connect(bob)
      .executeTransaction(wardenToken.address, "0", "transferOwnership(address)", encodeParameters(["address"], [carol.address]), eta)
    expect(await wardenToken.owner()).to.equal(carol.address)
  })

  it("should also work with MasterChef", async () => {
    lp1 = await ERC20Mock.deploy("LPToken", "LP", "10000000000")
    lp2 = await ERC20Mock.deploy("LPToken", "LP", "10000000000")
    chef = await MasterChef.deploy(wardenToken.address, tempest.address, dev.address, "1000", "0")
    await wardenToken.transferOwnership(chef.address)
    await chef.add("100", lp1.address, true)
    await chef.transferOwnership(timelock.address)
    const eta = (await latest()).add(duration.days(4))
    await timelock
      .connect(bob)
      .queueTransaction(
        chef.address,
        "0",
        "set(uint256,uint256,bool)",
        encodeParameters(["uint256", "uint256", "bool"], ["1", "200", false]),
        eta
      )
    await timelock
      .connect(bob)
      .queueTransaction(
        chef.address,
        "0",
        "add(uint256,address,bool)",
        encodeParameters(["uint256", "address", "bool"], ["100", lp2.address, false]),
        eta
      )
    await increase(duration.days(4))
    await timelock
      .connect(bob)
      .executeTransaction(
        chef.address,
        "0",
        "set(uint256,uint256,bool)",
        encodeParameters(["uint256", "uint256", "bool"], ["1", "200", false]),
        eta
      )
    await timelock
      .connect(bob)
      .executeTransaction(
        chef.address,
        "0",
        "add(uint256,address,bool)",
        encodeParameters(["uint256", "address", "bool"], ["100", lp2.address, false]),
        eta
      )
    expect((await chef.poolInfo("1")).allocPoint).to.equal("200")
    expect((await chef.poolInfo("2")).allocPoint).to.equal("100")
    expect(await chef.totalAllocPoint()).to.equal("300")
    expect(await chef.poolLength()).to.equal("3")
  })
})
