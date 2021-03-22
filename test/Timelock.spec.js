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

    timelock = await Timelock.deploy(bob.address, "86400") // 1 day
    await timelock.deployed()
  })

  it('Should init data correctly', async () => {
    expect(await timelock.GRACE_PERIOD()).to.equal(duration.days(14))
    expect(await timelock.MINIMUM_DELAY()).to.equal(duration.days(1))
    expect(await timelock.MAXIMUM_DELAY()).to.equal(duration.days(30))

    expect(await timelock.admin()).to.equal(bob.address)
    expect(await timelock.pendingAdmin()).to.equal(constants.AddressZero)
    expect(await timelock.delay()).to.equal(duration.days(1))
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

  it('Should receive ether properly', async () => {
    const etherAmount =utils.parseEther('1')
    await expect(() => alice.sendTransaction({
      to: timelock.address,
      value: etherAmount
    }))
    .to.changeEtherBalance(timelock, etherAmount)
  })

  it('Should fail if deploy with delay improperly', async () => {
    await expect(
      Timelock.deploy(bob.address, duration.hours(12))
    ).to.be.revertedWith('Timelock::constructor: Delay must exceed minimum delay.')
    
    await expect(
      Timelock.deploy(bob.address, duration.hours(23))
    ).to.be.revertedWith('Timelock::constructor: Delay must exceed minimum delay.')
    
    // expect(duration.hours(24)).to.equal(duration.days(1))
    await expect(
      Timelock.deploy(bob.address, duration.days(1))
    ).to.not.reverted
    
    await expect(
      Timelock.deploy(bob.address, duration.days(30))
    ).to.not.reverted

    await expect(
      Timelock.deploy(bob.address, duration.days(31))
    ).to.be.revertedWith('Timelock::constructor: Delay must not exceed maximum delay.')
  })

  it('should fail if queue transaction improperly', async () => {
    lp1 = await ERC20Mock.deploy("LPToken", "LP", "10000000000")
    lp2 = await ERC20Mock.deploy("LPToken", "LP", "10000000000")
    chef = await MasterChef.deploy(wardenToken.address, tempest.address, dev.address, "1000", "0")
    await wardenToken.transferOwnership(chef.address)
    await chef.add("100", lp1.address, true)
    await chef.transferOwnership(timelock.address)
    let eta

    eta = (await latest()).add(duration.hours(23))
    await expect(timelock
      .connect(bob)
      .queueTransaction(
        chef.address,
        "0",
        "set(uint256,uint256,bool)",
        encodeParameters(["uint256", "uint256", "bool"], ["1", "200", false]),
        eta
      )
    ).to.be.revertedWith('Timelock::queueTransaction: Estimated execution block must satisfy delay.')
    
    eta = (await latest()).add(duration.hours(25))
    await expect(timelock
      .connect(bob)
      .queueTransaction(
        chef.address,
        "0",
        "set(uint256,uint256,bool)",
        encodeParameters(["uint256", "uint256", "bool"], ["1", "200", false]),
        eta
      )
    ).to.not.reverted
  })

  describe('Add some queue transactions', async () => {
    beforeEach(async () => {
      lp1 = await ERC20Mock.deploy("LPToken", "LP", "10000000000")
      lp2 = await ERC20Mock.deploy("LPToken", "LP", "10000000000")
      chef = await MasterChef.deploy(wardenToken.address, tempest.address, dev.address, "1000", "0")
      await wardenToken.transferOwnership(chef.address)
      await chef.add("100", lp1.address, true)
      await chef.transferOwnership(timelock.address)

      eta = (await latest()).add(duration.hours(25))
      await timelock
        .connect(bob)
        .queueTransaction(
          chef.address,
          "0",
          "set(uint256,uint256,bool)",
          encodeParameters(["uint256", "uint256", "bool"], ["1", "200", false]),
          eta
        )
    })

    it('should execute transaction properly', async () => {
      await increase(duration.hours(25))
      await timelock
        .connect(bob)
        .executeTransaction(
          chef.address,
          "0",
          "set(uint256,uint256,bool)",
          encodeParameters(["uint256", "uint256", "bool"], ["1", "200", false]),
          eta
        )
    })

    it('should fail to execute transaction if submit early', async () => {
      await increase(duration.hours(20))
      await expect(timelock
        .connect(bob)
        .executeTransaction(
          chef.address,
          "0",
          "set(uint256,uint256,bool)",
          encodeParameters(["uint256", "uint256", "bool"], ["1", "200", false]),
          eta
        )
      ).to.be.revertedWith("Timelock::executeTransaction: Transaction hasn't surpassed time lock.")
    })

    it('should cancel transaction properly', async () => {
      await increase(duration.hours(25))

      await timelock
        .connect(bob)
        .cancelTransaction(
          chef.address,
          "0",
          "set(uint256,uint256,bool)",
          encodeParameters(["uint256", "uint256", "bool"], ["1", "200", false]),
          eta
        )

      await expect(timelock
        .connect(bob)
        .executeTransaction(
          chef.address,
          "0",
          "set(uint256,uint256,bool)",
          encodeParameters(["uint256", "uint256", "bool"], ["1", "200", false]),
          eta
        )
      ).to.be.revertedWith("Timelock::executeTransaction: Transaction hasn't been queued.")
    })

    it('should fail if execute transaction twice', async () => {
      await increase(duration.hours(25))
      await timelock
        .connect(bob)
        .executeTransaction(
          chef.address,
          "0",
          "set(uint256,uint256,bool)",
          encodeParameters(["uint256", "uint256", "bool"], ["1", "200", false]),
          eta
        )
      
      await expect(timelock
        .connect(bob)
        .executeTransaction(
          chef.address,
          "0",
          "set(uint256,uint256,bool)",
          encodeParameters(["uint256", "uint256", "bool"], ["1", "200", false]),
          eta
        )
      ).to.be.revertedWith("Timelock::executeTransaction: Transaction hasn't been queued.")
    })
  })

  it('Should fail if submit by non-admin', async () => {
    lp1 = await ERC20Mock.deploy("LPToken", "LP", "10000000000")
    lp2 = await ERC20Mock.deploy("LPToken", "LP", "10000000000")
    chef = await MasterChef.deploy(wardenToken.address, tempest.address, dev.address, "1000", "0")
    await wardenToken.transferOwnership(chef.address)
    await chef.add("100", lp1.address, true)
    await chef.transferOwnership(timelock.address)

    eta = (await latest()).add(duration.hours(25))
    await expect(timelock
      .connect(alice)
      .queueTransaction(
        chef.address,
        "0",
        "set(uint256,uint256,bool)",
        encodeParameters(["uint256", "uint256", "bool"], ["1", "200", false]),
        eta
      )
    ).to.be.revertedWith("Timelock::queueTransaction: Call must come from admin.")

    await expect(timelock
      .connect(alice)
      .cancelTransaction(
        chef.address,
        "0",
        "set(uint256,uint256,bool)",
        encodeParameters(["uint256", "uint256", "bool"], ["1", "200", false]),
        eta
      )
    ).to.be.revertedWith("Timelock::cancelTransaction: Call must come from admin.")

    await expect(timelock
      .connect(alice)
      .executeTransaction(
        chef.address,
        "0",
        "set(uint256,uint256,bool)",
        encodeParameters(["uint256", "uint256", "bool"], ["1", "200", false]),
        eta
      )
    ).to.be.revertedWith("Timelock::executeTransaction: Call must come from admin.")

    await expect(timelock
      .connect(alice)
      .setPendingAdmin(carol.address)
    ).to.be.revertedWith("Timelock::setPendingAdmin: First call must come from admin.")
  })

  it('Should update admin properly', async () => {
    expect(await timelock.admin()).to.equal(bob.address)

    await timelock.connect(bob).setPendingAdmin(carol.address)
    expect(await timelock.pendingAdmin()).to.equal(carol.address)

    await timelock.connect(carol).acceptAdmin()
    expect(await timelock.admin()).to.equal(carol.address)
  })

  it('Should update new delay properly', async () => {
    expect(await timelock.delay()).to.equal(duration.days(1))

    await expect(timelock.connect(bob).setDelay(duration.days(2)))
    .to.be.revertedWith('Timelock::setDelay: Call must come from Timelock.')

    eta = (await latest()).add(duration.hours(25))
    await timelock
      .connect(bob)
      .queueTransaction(
        timelock.address,
        "0",
        "setDelay(uint256)",
        encodeParameters(["uint256"], [duration.days(2)]),
        eta
      )
    await increase(duration.hours(26))
    await timelock
      .connect(bob)
      .executeTransaction(
        timelock.address,
        "0",
        "setDelay(uint256)",
        encodeParameters(["uint256"], [duration.days(2)]),
        eta
      )
    expect(await timelock.delay()).to.equal(duration.days(2))
  })

  describe('Update parameters', async () => {
    beforeEach(async () => {
      lp1 = await ERC20Mock.deploy('WAD-BNB', 'LP', '10000000000')
      lp2 = await ERC20Mock.deploy('BNB-BUSD', 'LP', '10000000000')
      lp3 = await ERC20Mock.deploy('BNB-BTCB', 'LP', '10000000000')
      lp4 = await ERC20Mock.deploy('BNB-ETH', 'LP', '10000000000')
      lp5 = await ERC20Mock.deploy('BUSD-USDT', 'LP', '10000000000')
      lp6 = await ERC20Mock.deploy('BNB-CAKE', 'LP', '10000000000')

      chef = await MasterChef.deploy(wardenToken.address, tempest.address, dev.address, utils.parseUnits('1', 18).toString(), '0')
      await wardenToken.transferOwnership(chef.address)
      await chef.add('4000', lp1.address, true)
      await chef.add('2000', lp2.address, true)
      await chef.add('1000', lp3.address, true)
      await chef.add('1000', lp4.address, true)
      await chef.add('500', lp5.address, true)
      await chef.add('200', lp6.address, true)
      await chef.updateMultiplier(80)
      await chef.transferOwnership(timelock.address)
    })

    it('Should init farms properly', async () => {
      expect(await chef.poolLength()).to.equal(7)
      expect(await chef.totalAllocPoint()).to.equal(8700)
      expect((await chef.poolInfo(0)).allocPoint).to.equal(0)
      expect((await chef.poolInfo(1)).allocPoint).to.equal(4000)
      expect((await chef.poolInfo(2)).allocPoint).to.equal(2000)
      expect((await chef.poolInfo(3)).allocPoint).to.equal(1000)
      expect((await chef.poolInfo(4)).allocPoint).to.equal(1000)
      expect((await chef.poolInfo(5)).allocPoint).to.equal(500)
      expect((await chef.poolInfo(6)).allocPoint).to.equal(200)
    })

    it('Should update multiplier to 40 properly', async () => {
      expect(await chef.BONUS_MULTIPLIER()).to.equal(80)
      
      const chefAddress = chef.address
      const encodedData = encodeParameters(["uint256"], ["40"])
      eta = (await latest()).add(duration.hours(25))
      await timelock
        .connect(bob)
        .queueTransaction(
          chefAddress,
          "0",
          "updateMultiplier(uint256)",
          encodedData,
          eta
        )
      await increase(duration.hours(26))
      await timelock
        .connect(bob)
        .executeTransaction(
          chefAddress,
          "0",
          "updateMultiplier(uint256)",
          encodedData,
          eta
        )
      
      expect(await chef.BONUS_MULTIPLIER()).to.equal(40)
    })

    describe('Multiplier is 40', async () => {
      beforeEach(async () => {
        const chefAddress = chef.address
        const encodedData = encodeParameters(["uint256"], ["40"])
        eta = (await latest()).add(duration.hours(25))
        const queueTx = await timelock
          .connect(bob)
          .queueTransaction(
            chefAddress,
            "0",
            "updateMultiplier(uint256)",
            encodedData,
            eta
          )
        await increase(duration.hours(26))
        const executeTx = await timelock
          .connect(bob)
          .executeTransaction(
            chefAddress,
            "0",
            "updateMultiplier(uint256)",
            encodedData,
            eta
          )
        expect(await chef.BONUS_MULTIPLIER()).to.equal(40)
      })

      it('Should add WAD-BUSD farm with 30x properly', async () => {
        expect(await chef.totalAllocPoint()).to.equal(8700)
      
        const chefAddress = chef.address
        const lp7Addpress = '0xc95B1750043FCE5dfCc8539835Ea3830Ec002A89'
        const encodedData = encodeParameters(['uint256', 'address', 'bool'], ['3000', lp7Addpress, true])
        eta = (await latest()).add(duration.hours(25))
        const queueTx = await timelock
          .connect(bob)
          .queueTransaction(
            chefAddress,
            '0',
            'add(uint256,address,bool)',
            encodedData,
            eta
          )

        await increase(duration.hours(26))
        const executeTx = await timelock
          .connect(bob)
          .executeTransaction(
            chefAddress,
            '0',
            'add(uint256,address,bool)',
            encodedData,
            eta
          )
        
        const pool7 = await chef.poolInfo(7)
        expect(pool7.lpToken).to.equal(lp7Addpress)
        expect(pool7.allocPoint).to.equal(3000)
        expect(await chef.poolLength()).to.equal(8)
        expect(await chef.totalAllocPoint()).to.equal(11700)
      })

      describe('Add WAD-BUSD with 30x', async () => {
        beforeEach(async () => {
          const chefAddress = chef.address
          const lp7 = await ERC20Mock.deploy('WAD-BUSD', 'LP', '10000000000')
          const encodedData = encodeParameters(['uint256', 'address', 'bool'], ['3000', lp7.address, true])
          eta = (await latest()).add(duration.hours(25))
          const queueTx = await timelock
            .connect(bob)
            .queueTransaction(
              chefAddress,
              '0',
              'add(uint256,address,bool)',
              encodedData,
              eta
            )

          await increase(duration.hours(26))
          const executeTx = await timelock
            .connect(bob)
            .executeTransaction(
              chefAddress,
              '0',
              'add(uint256,address,bool)',
              encodedData,
              eta
            )
          
          const pool7 = await chef.poolInfo(7)
        })

        it('Should update multiplier to 20 properly', async () => {
          expect(await chef.BONUS_MULTIPLIER()).to.equal(40)
      
          const chefAddress = chef.address
          const encodedData = encodeParameters(["uint256"], ["20"])
          eta = (await latest()).add(duration.hours(25))
          const queueTx = await timelock
            .connect(bob)
            .queueTransaction(
              chefAddress,
              "0",
              "updateMultiplier(uint256)",
              encodedData,
              eta
            )

          await increase(duration.hours(26))
          const executeTx = await timelock
            .connect(bob)
            .executeTransaction(
              chefAddress,
              "0",
              "updateMultiplier(uint256)",
              encodedData,
              eta
            )
          
          expect(await chef.BONUS_MULTIPLIER()).to.equal(20)
        })

        describe('Multiplier is 20', async () => {
          beforeEach(async () => {
            const chefAddress = chef.address
            const encodedData = encodeParameters(["uint256"], ["20"])
            eta = (await latest()).add(duration.hours(25))
            const queueTx = await timelock
              .connect(bob)
              .queueTransaction(
                chefAddress,
                "0",
                "updateMultiplier(uint256)",
                encodedData,
                eta
              )

            await increase(duration.hours(26))
            const executeTx = await timelock
              .connect(bob)
              .executeTransaction(
                chefAddress,
                "0",
                "updateMultiplier(uint256)",
                encodedData,
                eta
              )
          })

          it('Should set Single WAD farm (P0) with 1x properly', async () => {
            const pool0Before = await chef.poolInfo(0)
            expect(pool0Before.lpToken).to.equal(wardenToken.address)
            expect(pool0Before.allocPoint).to.equal(0)
            expect(await chef.poolLength()).to.equal(8)
            expect(await chef.totalAllocPoint()).to.equal(11700)

            const chefAddress = chef.address
            const encodedData = encodeParameters(['uint256', 'uint256', 'bool'], ['0', '100', true])
            eta = (await latest()).add(duration.hours(25))
            const queueTx = await timelock
              .connect(bob)
              .queueTransaction(
                chefAddress,
                '0',
                'set(uint256,uint256,bool)',
                encodedData,
                eta
              )

            await increase(duration.hours(26))
            await timelock
              .connect(bob)
              .executeTransaction(
                chefAddress,
                '0',
                'set(uint256,uint256,bool)',
                encodedData,
                eta
              )
            
            const pool0After = await chef.poolInfo(0)
            expect(pool0After.lpToken).to.equal(wardenToken.address)
            expect(pool0After.allocPoint).to.equal(100)
            expect(await chef.poolLength()).to.equal(8)
            expect(await chef.totalAllocPoint()).to.equal(11800)
          })

          describe('Set WAD farm with 1x', async () => {
            beforeEach(async () => {
              const chefAddress = chef.address
              const encodedData = encodeParameters(['uint256', 'uint256', 'bool'], ['0', '100', true])
              eta = (await latest()).add(duration.hours(25))
              const queueTx = await timelock
                .connect(bob)
                .queueTransaction(
                  chefAddress,
                  '0',
                  'set(uint256,uint256,bool)',
                  encodedData,
                  eta
                )

              await increase(duration.hours(26))
              await timelock
                .connect(bob)
                .executeTransaction(
                  chefAddress,
                  '0',
                  'set(uint256,uint256,bool)',
                  encodedData,
                  eta
                )
            })

            it('Should update multiplier to 10 properly', async () => {
              expect(await chef.BONUS_MULTIPLIER()).to.equal(20)
          
              const chefAddress = chef.address
              const encodedData = encodeParameters(["uint256"], ["10"])
              console.log('encodedData', encodedData)
              console.log('')
              eta = (await latest()).add(duration.hours(25))
              const queueTx = await timelock
                .connect(bob)
                .queueTransaction(
                  chefAddress,
                  "0",
                  "updateMultiplier(uint256)",
                  encodedData,
                  eta
                )
              console.log('queueTx', queueTx.data)
              console.log('')
              console.log('')
    
              await increase(duration.hours(26))
              const executeTx = await timelock
                .connect(bob)
                .executeTransaction(
                  chefAddress,
                  "0",
                  "updateMultiplier(uint256)",
                  encodedData,
                  eta
                )
              
              expect(await chef.BONUS_MULTIPLIER()).to.equal(10)
            })
          })
        })
      })
    })
  })
})
