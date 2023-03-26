//本文件为主体deploy文件，与mock联合，用于判断当前网络是否为本地网，如果是本地网就deploy mock，如果是testnet就通过hardhat.config.js提取API key进行deploy
const { network } = require("hardhat")
const { developmentChains, networkConfig } = require("../helper-hardhat-config")
const { verify } = require("../utils/verify")

const FUND_AMOUNT = ethers.utils.parseEther("1")

module.exports = async function ({ getNamedAccounts, deployments }) {
    const { deploy, log } = deployments
    const { deployer } = await getNamedAccounts()
    const chainId = network.config.chainId
    let vrfCoordinatorV2Address, subscriptionId, vrfCoordinatorV2Mock

    if (developmentChains.includes(network.name)) {
        //mock
        vrfCoordinatorV2Mock = await ethers.getContract("VRFCoordinatorV2Mock")
        vrfCoordinatorV2Address = vrfCoordinatorV2Mock.address //拿到合约对象的地址
        const transactionResponse =
            await vrfCoordinatorV2Mock.createSubscription()
        const transactionReceipt = await transactionResponse.wait(1)
        subscriptionId = transactionReceipt.events[0].args.subId //可以在mock合约中看到createSubscription函数中emit了一个event，该event在Line32，第一个参数就是subId
        // Fund the subscription
        // Our mock makes it so we don't actually have to worry about sending fund
        await vrfCoordinatorV2Mock.fundSubscription(subscriptionId, FUND_AMOUNT) //如果是mock，调用这个参数就自己fund了
    } else {
        //real testnet
        vrfCoordinatorV2Address = networkConfig[chainId]["vrfCoordinatorV2"]
        subscriptionId = networkConfig[chainId]["subscriptionId"]
    }

    const args = [
        vrfCoordinatorV2Address,
        networkConfig[chainId]["raffleEntranceFee"],
        subscriptionId,
        networkConfig[chainId]["gasLane"],
        networkConfig[chainId]["callbackGasLimit"],
        networkConfig[chainId]["keepersUpdateInterval"],
    ]
    // address vrfCoordinatorV2, //contract
    //     uint256 entranceFee,
    //     uint64 subscriptionId,
    //     bytes32 gasLane, // keyHash
    //     uint32 callbackGasLimit,
    //     uint256 interval

    const raffle = await deploy("Raffle", {
        from: deployer,
        args: args, //构造函数的参数
        log: true,
        waitConfirmations: network.config.blockConfirmations || 1,
    })

    // Ensure the Raffle contract is a valid consumer of the VRFCoordinatorV2Mock contract.
    if (developmentChains.includes(network.name)) {
        const vrfCoordinatorV2Mock = await ethers.getContract(
            "VRFCoordinatorV2Mock"
        )
        await vrfCoordinatorV2Mock.addConsumer(subscriptionId, raffle.address)
    }

    // Verify the deployment
    if (
        !developmentChains.includes(network.name) &&
        process.env.ETHERSCAN_API_KEY
    ) {
        log("Verifying...")
        await verify(raffle.address, args)
    }

    log("Enter lottery with command:")
    const networkName = network.name == "hardhat" ? "localhost" : network.name
    log(`yarn hardhat run scripts/enterRaffle.js --network ${networkName}`)
    log("----------------------------------------------------")
}

module.exports.tags = ["all", "raffle"]
