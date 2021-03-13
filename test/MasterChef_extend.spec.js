const { expect } = require('chai')
const chai = require('chai')
const { Contract, utils, constants } = require ('ethers')
const { solidity, deployContract } = require('ethereum-waffle')
const { waffle } = require ('@nomiclabs/buidler')
const { ecsign } = require('ethereumjs-util')
const { getApprovalDigest } = require('./shared/utilities')
const { advanceBlockTo } = require('./utilities/time')

chai.use(solidity)

describe("MasterChef Extend", () => {
  const [alice, bob, carol, dev, minter] = waffle.provider.getWallets()

  let MasterChef
  let WardenToken
  let ERC20Mock

  let wardenToken
  let tempest


  beforeEach(async () => {
    MasterChef = await ethers.getContractFactory("MasterChef")
    WardenToken = await ethers.getContractFactory("WardenToken")
    Tempest = await ethers.getContractFactory("Tempest")
    ERC20Mock = await ethers.getContractFactory("MockERC20", minter)

    wardenToken = await WardenToken.deploy()
    await wardenToken.deployed()

    tempest = await Tempest.deploy(wardenToken.address)
    await tempest.deployed()

  })

  it("should set correct state variables", async () => {
    const chef = await MasterChef.deploy(wardenToken.address, tempest.address, dev.address, "1000", "0")
    await chef.deployed()

    await wardenToken.transferOwnership(chef.address)
    // console.log('chef', chef)

    const warden = await chef.warden()
    const devaddr = await chef.devaddr()
    const owner = await wardenToken.owner()

    expect(warden).to.equal(wardenToken.address)
    expect(devaddr).to.equal(dev.address)
    expect(owner).to.equal(chef.address)
  })

  it("should allow dev and only dev to update dev", async () => {
    const chef = await MasterChef.deploy(wardenToken.address, tempest.address, dev.address, "1000", "0")
    await chef.deployed()

    expect(await chef.devaddr()).to.equal(dev.address)

    await expect(chef.connect(bob).dev(bob.address, { from: bob.address })).to.be.revertedWith("dev: wut?")

    await chef.connect(dev).dev(bob.address, { from: dev.address })

    expect(await chef.devaddr()).to.equal(bob.address)

    await chef.connect(bob).dev(alice.address, { from: bob.address })

    expect(await chef.devaddr()).to.equal(alice.address)
  })

  describe("With ERC/LP token added to the field", async () => {
    let lp
    let lp2

    beforeEach(async () => {
      lp = await ERC20Mock.deploy("LPToken", "LP", "10000000000")

      await lp.transfer(alice.address, "1000")

      await lp.transfer(bob.address, "1000")

      await lp.transfer(carol.address, "1000")

      lp2 = await ERC20Mock.deploy("LPToken2", "LP2", "10000000000")

      await lp2.transfer(alice.address, "1000")

      await lp2.transfer(bob.address, "1000")

      await lp2.transfer(carol.address, "1000")
    })

    it("should allow emergency withdraw", async () => {
      // 100 per block farming rate starting at block 100 with bonus until block 1000
      const chef = await MasterChef.deploy(wardenToken.address, tempest.address, dev.address, "100", "100")
      await chef.deployed()

      await chef.add("100", lp.address, true)

      await lp.connect(bob).approve(chef.address, "1000")

      await chef.connect(bob).deposit(1, "100")

      expect(await lp.balanceOf(bob.address)).to.equal("900")

      await chef.connect(bob).emergencyWithdraw(1)

      expect(await lp.balanceOf(bob.address)).to.equal("1000")
    })

    it("should give out SUSHIs only after farming time", async () => {
      // 100 per block farming rate starting at block 100 with bonus until block 1000
      const chef = await MasterChef.deploy(wardenToken.address, tempest.address, dev.address, "100", "100")
      await chef.deployed()

      await wardenToken.transferOwnership(chef.address)
      await tempest.transferOwnership(chef.address)
      await chef.set(0, 0, true)
      await chef.updateMultiplier(10)

      await chef.add("100", lp.address, true)

      await lp.connect(bob).approve(chef.address, "1000")
      await chef.connect(bob).deposit(1, "100")
      await advanceBlockTo("89")

      await chef.connect(bob).deposit(1, "0") // block 90
      expect(await wardenToken.balanceOf(bob.address)).to.equal("0")
      await advanceBlockTo("94")

      await chef.connect(bob).deposit(1, "0") // block 95
      expect(await wardenToken.balanceOf(bob.address)).to.equal("0")
      await advanceBlockTo("99")

      await chef.connect(bob).deposit(1, "0") // block 100
      expect(await wardenToken.balanceOf(bob.address)).to.equal("0")
      await advanceBlockTo("100")

      await chef.connect(bob).deposit(1, "0") // block 101
      expect(await wardenToken.balanceOf(bob.address)).to.equal("1000")

      await advanceBlockTo("104")
      await chef.connect(bob).deposit(1, "0") // block 105

      expect(await wardenToken.balanceOf(bob.address)).to.equal("5000")
      expect(await wardenToken.balanceOf(dev.address)).to.equal("625")
      expect(await wardenToken.totalSupply()).to.equal("5625")
    })

    it("should not distribute SUSHIs if no one deposit", async () => {
      // 100 per block farming rate starting at block 200 with bonus until block 1000
      const chef = await MasterChef.deploy(wardenToken.address, tempest.address, dev.address, "100", "200")
      await chef.deployed()
      await wardenToken.transferOwnership(chef.address)
      await tempest.transferOwnership(chef.address)
      await chef.set(0, 0, true)
      await chef.updateMultiplier(10)

      await chef.add("100", lp.address, true)
      await lp.connect(bob).approve(chef.address, "1000")
      await advanceBlockTo("199")
      expect(await wardenToken.totalSupply()).to.equal("0")
      await advanceBlockTo("204")
      expect(await wardenToken.totalSupply()).to.equal("0")
      await advanceBlockTo("209")
      await chef.connect(bob).deposit(1, "10") // block 210
      expect(await wardenToken.totalSupply()).to.equal("0")
      expect(await wardenToken.balanceOf(bob.address)).to.equal("0")
      expect(await wardenToken.balanceOf(dev.address)).to.equal("0")
      expect(await lp.balanceOf(bob.address)).to.equal("990")
      await advanceBlockTo("219")
      await chef.connect(bob).withdraw(1, "10") // block 220
      expect(await wardenToken.totalSupply()).to.equal("11250")
      expect(await wardenToken.balanceOf(bob.address)).to.equal("10000")
      expect(await wardenToken.balanceOf(dev.address)).to.equal("1250")
      expect(await lp.balanceOf(bob.address)).to.equal("1000")
    })

    it("should distribute SUSHIs properly for each staker", async () => {
      // 100 per block farming rate starting at block 300 with bonus until block 1000
      const chef = await MasterChef.deploy(wardenToken.address, tempest.address, dev.address, "100", "300")
      await chef.deployed()
      await wardenToken.transferOwnership(chef.address)
      await tempest.transferOwnership(chef.address)
      await chef.set(0, 0, true)
      await chef.updateMultiplier(10)

      await chef.add("100", lp.address, true)
      await lp.connect(alice).approve(chef.address, "1000", {
        from: alice.address,
      })
      await lp.connect(bob).approve(chef.address, "1000", {
        from: bob.address,
      })
      await lp.connect(carol).approve(chef.address, "1000", {
        from: carol.address,
      })
      // Alice deposits 10 LPs at block 310
      await advanceBlockTo("309")
      await chef.connect(alice).deposit(1, "10", { from: alice.address })
      // Bob deposits 20 LPs at block 314
      await advanceBlockTo("313")
      await chef.connect(bob).deposit(1, "20", { from: bob.address })
      // Carol deposits 30 LPs at block 318
      await advanceBlockTo("317")
      await chef.connect(carol).deposit(1, "30", { from: carol.address })
      // Alice deposits 10 more LPs at block 320. At this point:
      //   Alice should have: 4*1000 + 4*1/3*1000 + 2*1/6*1000 = 5666
      //   MasterChef should have the remaining: 10000 - 5666 = 4334
      await advanceBlockTo("319")
      await chef.connect(alice).deposit(1, "10", { from: alice.address })
      expect(await wardenToken.totalSupply()).to.equal("11250")
      expect(await wardenToken.balanceOf(alice.address)).to.equal("5666")
      expect(await wardenToken.balanceOf(bob.address)).to.equal("0")
      expect(await wardenToken.balanceOf(carol.address)).to.equal("0")
      expect(await wardenToken.balanceOf(chef.address)).to.equal("0") // todo:
      expect(await wardenToken.balanceOf(dev.address)).to.equal("1250")
      // Bob withdraws 5 LPs at block 330. At this point:
      //   Bob should have: 4*2/3*1000 + 2*2/6*1000 + 10*2/7*1000 = 6190
      await advanceBlockTo("329")
      await chef.connect(bob).withdraw(1, "5", { from: bob.address })
      expect(await wardenToken.totalSupply()).to.equal("22500")
      expect(await wardenToken.balanceOf(alice.address)).to.equal("5666")
      expect(await wardenToken.balanceOf(bob.address)).to.equal("6190")
      expect(await wardenToken.balanceOf(carol.address)).to.equal("0")
      expect(await wardenToken.balanceOf(chef.address)).to.equal("0") // todo:
      expect(await wardenToken.balanceOf(dev.address)).to.equal("2500")
      // Alice withdraws 20 LPs at block 340.
      // Bob withdraws 15 LPs at block 350.
      // Carol withdraws 30 LPs at block 360.
      await advanceBlockTo("339")
      await chef.connect(alice).withdraw(1, "20", { from: alice.address })
      await advanceBlockTo("349")
      await chef.connect(bob).withdraw(1, "15", { from: bob.address })
      await advanceBlockTo("359")
      await chef.connect(carol).withdraw(1, "30", { from: carol.address })
      expect(await wardenToken.totalSupply()).to.equal("56250")
      expect(await wardenToken.balanceOf(dev.address)).to.equal("6250")
      // Alice should have: 5666 + 10*2/7*1000 + 10*2/6.5*1000 = 11600
      expect(await wardenToken.balanceOf(alice.address)).to.equal("11600")
      // Bob should have: 6190 + 10*1.5/6.5 * 1000 + 10*1.5/4.5*1000 = 11831
      expect(await wardenToken.balanceOf(bob.address)).to.equal("11831")
      // Carol should have: 2*3/6*1000 + 10*3/7*1000 + 10*3/6.5*1000 + 10*3/4.5*1000 + 10*1000 = 26568
      expect(await wardenToken.balanceOf(carol.address)).to.equal("26568")
      // All of them should have 1000 LPs back.
      expect(await lp.balanceOf(alice.address)).to.equal("1000")
      expect(await lp.balanceOf(bob.address)).to.equal("1000")
      expect(await lp.balanceOf(carol.address)).to.equal("1000")
    })

    it("should give proper SUSHIs allocation to each pool", async () => {
      // 100 per block farming rate starting at block 400 with bonus until block 1000
      const chef = await MasterChef.deploy(wardenToken.address, tempest.address, dev.address, "100", "400")
      await wardenToken.transferOwnership(chef.address)
      await tempest.transferOwnership(chef.address)
      await chef.set(0, 0, true)
      await chef.updateMultiplier(10)

      await lp.connect(alice).approve(chef.address, "1000", { from: alice.address })
      await lp2.connect(bob).approve(chef.address, "1000", { from: bob.address })
      // Add first LP to the pool with allocation 1
      await chef.add("10", lp.address, true)
      // Alice deposits 10 LPs at block 410
      await advanceBlockTo("409")
      await chef.connect(alice).deposit(1, "10", { from: alice.address })
      // Add LP2 to the pool with allocation 2 at block 420
      await advanceBlockTo("419")
      await chef.add("20", lp2.address, true)
      // Alice should have 10*1000 pending reward
      expect(await chef.pendingWarden(1, alice.address)).to.equal("10000")
      // Bob deposits 10 LP2s at block 425
      await advanceBlockTo("424")
      await chef.connect(bob).deposit(2, "5", { from: bob.address })
      // Alice should have 10000 + 5*1/3*1000 = 11666 pending reward
      expect(await chef.pendingWarden(1, alice.address)).to.equal("11666")
      await advanceBlockTo("430")
      // At block 430. Bob should get 5*2/3*1000 = 3333. Alice should get ~1666 more.
      expect(await chef.pendingWarden(1, alice.address)).to.equal("13333")
      expect(await chef.pendingWarden(2, bob.address)).to.equal("3333")
    })

    it("should stop giving bonus SUSHIs correctly", async () => {
      // 100 per block farming rate starting at block 500 with bonus until block 600
      const chef = await MasterChef.deploy(wardenToken.address, tempest.address, dev.address, "100", "500")
      await wardenToken.transferOwnership(chef.address)
      await tempest.transferOwnership(chef.address)
      await chef.set(0, 0, true)
      await chef.updateMultiplier(10)

      await lp.connect(alice).approve(chef.address, "1000", { from: alice.address })
      await chef.add("1", lp.address, true)
      // Alice deposits 10 LPs at block 590
      await advanceBlockTo("589")
      await chef.connect(alice).deposit(1, "10", { from: alice.address })
      // At block 605, she should have 1000*10 + 100*5 = 10500 pending.
      await advanceBlockTo("605")
      expect(await chef.pendingWarden(1, alice.address)).to.equal("15000")
      // At block 606, Alice withdraws all pending rewards and should get 10600.
      await chef.connect(alice).deposit(1, "0", { from: alice.address })
      expect(await chef.pendingWarden(1, alice.address)).to.equal("0")
      expect(await wardenToken.balanceOf(alice.address)).to.equal("16000")
    })
  })
})
