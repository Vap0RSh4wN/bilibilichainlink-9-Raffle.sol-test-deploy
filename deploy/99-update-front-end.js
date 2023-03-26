//本文件来源于10-11课，目的是希望在deploy的同时自动把合约的abi和address放进文件里并打包到前端的constants文件夹里。
const { ethers } = require("hardhat")
const fs = require("fs")
const { providers } = require("ethers")
const frontEndContractsFile =
    "../bilibilichainlink-10-nextjs-smartcontract-lottery-fcc/constants/contractAddress.json"

const frontEndAbiFile =
    "../bilibilichainlink-10-nextjs-smartcontract-lottery-fcc/constants/abi.json"

//并能实现如果合约改变，自动更新abi和address在前端。
module.exports = async () => {
    if (process.env.UPDATE_FRONT_END) {
        console.log("Updating front end...")
        updateContractAddresses()
        updateAbi()
    }
}

async function updateAbi() {
    const raffle = await ethers.getContract("Raffle")

    fs.writeFileSync(
        frontEndAbiFile,
        raffle.interface.format(ethers.utils.FormatTypes.json)
    )
    //直接得到abi并写入
    //可以直接去ethers.js文档里找。contract.interface 是合约的abi interface
}

async function updateContractAddresses() {
    const raffle = await ethers.getContract("Raffle")
    const contractAddresses = JSON.parse(
        fs.readFileSync(frontEndContractsFile, "utf8")
    )
    const chainId = network.config.chainId.toString()
    if (chainId in contractAddresses) {
        if (!contractAddresses[chainId].includes(raffle.address)) {
            contractAddresses[chainId].push(raffle.address)
        }
    } else {
        contractAddresses[chainId] = [raffle.address]
    }
    fs.writeFileSync(frontEndContractsFile, JSON.stringify(contractAddresses))
}

module.exports.tags = ["all", "frontend"]
