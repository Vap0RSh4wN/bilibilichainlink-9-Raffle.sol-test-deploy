//用于localhost，hardhat本地网络执行test，mock
const { assert, expect } = require("chai")
const { getNamedAccounts, deployments, ethers, network } = require("hardhat")
const { describe } = require("node:test")
const {
    developmentChains,
    networkConfig,
} = require("../../helper-hardhat-config")

!developmentChains.includes(network.name)
    ? describe.skip
    : describe("Raffle Unit Tests", async () => {
          let raffle,
              interval,
              vrfCoordinatorV2Mock,
              raffleEntranceFee,
              deployer

          beforeEach(async () => {
              deployer = (await getNamedAccounts()).deployer //拿到hardhat.config.js中namedAccounts字段里deployer
              await deployments.fixture(["all"])
              raffle = await ethers.getContract("Raffle", deployer)
              vrfCoordinatorV2Mock = await ethers.getContract(
                  "VRFCoordinatorV2Mock",
                  deployer
              )
              raffleEntranceFee = await raffle.getEntranceFee()
              interval = await raffle.getInterval()
          })

          describe("constructor", async () => {
              it("initializes the raffle correctly", async () => {
                  // Ideally, we'd separate these out so that only 1 assert per "it" block
                  // And ideally, we'd make this check everything
                  const raffleState = (await raffle.getRaffleState()).toString() //返回的是一个bignumber
                  // Comparisons for Raffle initialization:
                  assert.equal(raffleState, "0") //并且底层来说，其实第一个，也就是OPEN是0，第二个是1
                  assert.equal(
                      interval.toString(),
                      networkConfig[network.config.chainId][
                          "keepersUpdateInterval"
                      ]
                  )
              })
          })

          describe("enterRaffle", async () => {
              it("reverts when you don't pay enough", async () => {
                  await expect(raffle.enterRaffle()).to.be.revertedWith(
                      // is reverted when not paid enough or raffle is not open
                      "Raffle__NotEnoughETHEntered"
                  )
              })
              it("records player when they enter", async () => {
                  await raffle.enterRaffle({ value: raffleEntranceFee })
                  const playerFromContract = await raffle.getPlayer(0)
                  assert.equal(playerFromContract, deployer)
              })

              it("emits event on enter", async () => {
                  await expect(
                      raffle.enterRaffle({ value: raffleEntranceFee })
                  ).to.emit(raffle, "RaffleEnter") //合约名，事件名
              })

              it("doesnt allow entrance when raffle is calculating", async () => {
                  await raffle.enterRaffle({ value: raffleEntranceFee })
                  /*
                what we need to do is we need to make checkupkeep() return true 
                and we will pretend to be the chaINLINK keeper network to keep calling checkupKeep() waiting for to be true and once we make it true 
                and callperform upkeep to put this contract in a state of calculating
                 */
                  //如果想让那个函数返回true，首先要满足interval
                  //https://hardhat.org/hardhat-network/docs/reference#special-testing/debugging-methods
                  await network.provider.send("evm_increaseTime", [
                      interval.toNumber() + 1,
                  ]) //第一个参数是指令，第二个是参数，增加时间也相当于增加块间隔时长
                  await network.provider.send("evm_mine", []) //上面加多少时间，都不会继续出块，需要再调用evm_mine再出一个块
                  //现在performUpKeep()会返回true了
                  await raffle.performUpkeep([]) //空的calldata
                  //此时state应该是CALCULATING了
                  await expect(
                      raffle.enterRaffle({ value: raffleEntranceFee })
                  ).to.be.revertedWith("Raffle__NotOpen")
              })
          })

          describe("checkUpKeep", async () => {
              it("returns false if people haven't sent any ETH", async () => {
                  await network.provider.send("evm_increaseTime", [
                      interval.toNumber() + 1,
                  ])
                  await network.provider.send("evm_mine", [])

                  // callStatic:我感觉这玩意是不是模拟call然后返回参数？
                  // this can actually sending this transaction and seeing what this upkeepNeeded
                  // would return Well. I can actually get that by just something
                  // called call static. I can simulate calling this transaction and seeing
                  // what it will respond.

                  //https://docs.ethers.org/v5/api/contract/contract/#contract-callStatic
                  //Rather than executing the state-change of a transaction, it is possible to ask a node to pretend that a call is not state-changing and return the result.
                  // This does not actually change any state, but is free. This in some cases can be used to determine if a transaction will fail or succeed.
                  // This otherwise functions the same as a Read-Only Method.
                  // The overrides are identical to the read-only operations above.
                  const { upkeepNeeded } = await raffle.callStatic.checkUpkeep(
                      []
                  )
                  assert(!upkeepNeeded)
              })

              it("returns false if raffle isn't open", async () => {
                  await raffle.enterRaffle({ value: raffleEntranceFee })
                  await network.provider.send("evm_increaseTime", [
                      interval.toNumber() + 1,
                  ]) //第一个参数是指令，第二个是参数，增加时间也相当于增加块间隔时长
                  await network.provider.send("evm_mine", []) //上面加多少时间，都不会继续出块，需要再调用evm_mine再出一个块
                  //现在performUpKeep()会返回true了
                  await raffle.performUpkeep([]) //或者传入"0X"也是一个意思
                  const raffleState = await raffle.getRaffleState()
                  const { upkeepNeeded } = await raffle.callStatic.checkUpkeep(
                      []
                  ) //这时候状态还不是OPEN，会false
                  assert.equal(raffleState.toString(), "1") //CALCULATING
                  assert.equal(upkeepNeeded, false)
              })

              it("returns false if enough time hasn't passed", async () => {
                  await raffle.enterRaffle({ value: raffleEntranceFee })
                  await network.provider.send("evm_increaseTime", [
                      interval.toNumber() - 5,
                  ]) // use a higher number here if this test fails
                  await network.provider.request({
                      method: "evm_mine",
                      params: [],
                  })
                  const { upkeepNeeded } = await raffle.callStatic.checkUpkeep(
                      "0x"
                  ) // upkeepNeeded = (timePassed && isOpen && hasBalance && hasPlayers)
                  assert(!upkeepNeeded)
              })
              it("returns true if enough time has passed, has players, eth, and is open", async () => {
                  await raffle.enterRaffle({ value: raffleEntranceFee })
                  await network.provider.send("evm_increaseTime", [
                      interval.toNumber() + 1,
                  ])
                  await network.provider.request({
                      method: "evm_mine",
                      params: [],
                  })
                  const { upkeepNeeded } = await raffle.callStatic.checkUpkeep(
                      "0x"
                  ) // upkeepNeeded = (timePassed && isOpen && hasBalance && hasPlayers)
                  assert(upkeepNeeded)
              })
          })

          describe("performUpkeep", function () {
              it("can only run if checkupkeep is true", async () => {
                  await raffle.enterRaffle({ value: raffleEntranceFee })
                  await network.provider.send("evm_increaseTime", [
                      interval.toNumber() + 1,
                  ])
                  await network.provider.send("evm_mine", [])
                  const tx = await raffle.performUpkeep([])
                  assert(tx)
              })
              it("reverts if checkup is false", async () => {
                  await expect(raffle.performUpkeep("0x")).to.be.revertedWith(
                      "Raffle__UpkeepNotNeeded"
                  )
              })
              it("updates the raffle state and emits a requestId", async () => {
                  // Too many asserts in this test!
                  await raffle.enterRaffle({ value: raffleEntranceFee })
                  await network.provider.send("evm_increaseTime", [
                      interval.toNumber() + 1,
                  ])
                  await network.provider.send("evm_mine", [])
                  const txResponse = await raffle.performUpkeep([])
                  const txReceipt = await txResponse.wait(1)
                  const requestId = txReceipt.events[1].args.requestId //因为查看mock合约代码，Raffle合约中requestRandomWords()也会触发一个event。所以这里设置的events[是1而不是0，因为想取的是第二个]
                  const raffleState = await raffle.getRaffleState()
                  assert(
                      requestId.toNumber() > 0 && raffleState.toString() == "1"
                  )
              })
          })

          describe("fulfillRandomWords", function () {
              beforeEach(async () => {
                  await raffle.enterRaffle({ value: raffleEntranceFee })
                  await network.provider.send("evm_increaseTime", [
                      interval.toNumber() + 1,
                  ])
                  await network.provider.request({
                      method: "evm_mine",
                      params: [],
                  })
              })
              it("can only be called after performupkeep", async () => {
                  await expect(
                      vrfCoordinatorV2Mock.fulfillRandomWords(0, raffle.address) // reverts if not fulfilled
                  ).to.be.revertedWith("nonexistent request")
                  await expect(
                      vrfCoordinatorV2Mock.fulfillRandomWords(1, raffle.address) // reverts if not fulfilled
                  ).to.be.revertedWith("nonexistent request")
              })

              // This test is too big...
              // This test simulates users entering the raffle and wraps the entire functionality of the raffle
              // inside a promise that will resolve if everything is successful.
              // An event listener for the WinnerPicked is set up
              // Mocks of chainlink keepers and vrf coordinator are used to kickoff this winnerPicked event
              // All the assertions are done once the WinnerPicked event is fired
              it("picks a winner, resets, and sends money", async () => {
                  const additionalEntrances = 3 // to test
                  const startingIndex = 1 // deployer is the 0st account
                  for (
                      //虚拟了三个player入场
                      let i = startingIndex;
                      i < startingIndex + additionalEntrances;
                      i++
                  ) {
                      // i = 2; i < 5; i=i+1
                      raffle = raffleContract.connect(accounts[i]) // Returns a new instance of the Raffle contract connected to player
                      await raffle.enterRaffle({ value: raffleEntranceFee })
                  }
                  const startingTimeStamp = await raffle.getLastTimeStamp() // stores starting timestamp (before we fire our event)
                  // performUpkeep (mock being Chainlink Keepers)
                  // fulfillRandomWords (mock being the Chainlink VRF)
                  // This will be more important for our staging tests...
                  await new Promise(async (resolve, reject) => {
                      raffle.once("WinnerPicked", async () => {
                          //真实网络里我们无法控制，只能依赖监听器帮我们监听。
                          //在mock本地网络里，这个监视器listener将会在下面代码fulfillRandomWords执行后才会被触发。因为在本地网络里我们可以自己控制执行fulfillRandomWords函数，所以这里其实会先一直在后台监听，监听到下面fulfillRandomWords函数执行完后触发事件或超时，这里后面的代码才会执行。
                          //hardhat.config.js文件中的mocha里设置了倒计时，如果50000ms也就是500s没有触发这个事件，就自动reject()
                          // event listener for WinnerPicked
                          console.log("WinnerPicked event fired!")
                          // assert throws an error if it fails, so we need to wrap
                          // it in a try/catch so that the promise returns event
                          // if it fails.
                          try {
                              // Now lets get the ending values...
                              const recentWinner =
                                  await raffle.getRecentWinner()
                              const raffleState = await raffle.getRaffleState()
                              const winnerBalance =
                                  await accounts[2].getBalance()
                              const endingTimeStamp =
                                  await raffle.getLastTimeStamp()
                              await expect(raffle.getPlayer(0)).to.be.reverted
                              // Comparisons to check if our ending values are correct:
                              assert.equal(
                                  recentWinner.toString(),
                                  accounts[2].address
                              )
                              assert.equal(raffleState, 0)
                              assert.equal(
                                  winnerBalance.toString(),
                                  startingBalance // startingBalance + ( (raffleEntranceFee * additionalEntrances) + raffleEntranceFee )
                                      .add(
                                          raffleEntranceFee
                                              .mul(additionalEntrances)
                                              .add(raffleEntranceFee)
                                      )
                                      .toString()
                              )
                              assert(endingTimeStamp > startingTimeStamp)
                              resolve() // if try passes, resolves the promise
                          } catch (e) {
                              reject(e) // if try fails, rejects the promise
                          }
                      })

                      // kicking off the event by mocking the chainlink keepers and vrf coordinator
                      const tx = await raffle.performUpkeep("0x")
                      const txReceipt = await tx.wait(1)
                      const startingBalance = await accounts[2].getBalance()
                      await vrfCoordinatorV2Mock.fulfillRandomWords(
                          txReceipt.events[1].args.requestId,
                          raffle.address
                      )
                  })
              })
          })
      })
