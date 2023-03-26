// This implements the Chainlink VRF Version 2 and ChainLink Keepers
// Raffle
// Enter the lottery (paying some amount)
// Pick a random winner (verifiably random)
// Winner to be selected every X minutes -> completly automate// Chainlink Oracle -> Randomness, Automated Execution (Chainlink Keepers)

// SPDX-License-Identifier: MIT
pragma solidity ^0.8.7;

import "@chainlink/contracts/src/v0.8/interfaces/VRFCoordinatorV2Interface.sol";
import "@chainlink/contracts/src/v0.8/VRFConsumerBaseV2.sol";
// based https://docs.chain.link/vrf/v2/subscription/examples/get-a-random-number
import "@chainlink/contracts/src/v0.8/interfaces/KeeperCompatibleInterface.sol";

error Raffle__NotEnoughETHEntered();
error Raffle__TransferFailed();
error Raffle__NotOpen();
error Raffle__UpkeepNotNeeded(
    uint256 currentBalance,
    uint256 numPlayers,
    uint256 raffleState
);

contract Raffle is VRFConsumerBaseV2, KeeperCompatibleInterface {
    /* Type declarations */
    enum RaffleState {
        OPEN,
        CALCULATING
    }

    /* State Variables */
    uint256 private immutable i_entranceFee; //既省gas，又保证不变
    address payable[] private s_players;
    VRFCoordinatorV2Interface private immutable i_vrfCoordinator; //定义接口用来获得COORDINATOR，可以在https://docs.chain.link/vrf/v2/subscription/examples/get-a-random-number看到
    uint64 private immutable i_subscriptionId; //如下三个都是函数requestRandomWords的参数
    bytes32 private immutable i_gasLane;
    uint32 private immutable i_callbackGasLimit;
    uint16 private constant REQUEST_CONFIRMATIONS = 3;
    uint32 private constant NUM_WORDS = 1;

    // Lottery Variables
    address private s_recentWinner;
    RaffleState private s_raffleState; //不设置成bool的意义在于，这样变量就可以保存pending，open，closed，calculating等多种state
    uint256 private s_lastTimeStamp; //用来记录每一次的block.timestamp，这样就可以回溯并记录各个块之间的时间差
    uint256 private immutable i_interval; //定义时间间隔

    /* Events */
    event RaffleEnter(address indexed player);
    event RequestedRafflewinner(uint256 indexed requestId);
    event WinnerPicked(address indexed winner);

    //vrfCoordinatorV2(可以在node module/chainlink/src/v0.8/VRFConsumerBaseV2看构造函数参数) 这里是根据视频打的，可能是老版本的合约
    // is the address of the contract that does the random number of verifications

    constructor(
        address vrfCoordinatorV2, //contract
        uint256 entranceFee,
        uint64 subscriptionId,
        bytes32 gasLane, // keyHash
        uint32 callbackGasLimit,
        uint256 interval
    ) VRFConsumerBaseV2(vrfCoordinatorV2) {
        //上面第二个括号里的参数是第一个括号里本合约构造函数的参数输入并传过去的
        //也就是给父函数的构造函数也要传参，但是这个参没法直接传，要给子函数的构造函数先传值，再传给父函数的构造函数
        i_entranceFee = entranceFee;
        i_vrfCoordinator = VRFCoordinatorV2Interface(vrfCoordinatorV2);
        //相当于拿到了COORDINATOR，于‘docs.chain.link/vrf/v2/subscription/examples/get-a-random-number#:~:text=sender)%0A%20%20%20%20%7B-,COORDINATOR,-%3D%20VRFCoordinatorV2Interface(’

        i_gasLane = gasLane;
        i_subscriptionId = subscriptionId;
        i_callbackGasLimit = callbackGasLimit;

        s_raffleState = RaffleState.OPEN; //初始化状态为OPEN
        s_lastTimeStamp = block.timestamp;
        i_interval = interval;
    }

    function enterRaffle() public payable {
        //玩家入场这个博彩游戏的函数
        // require (msg.value > i_entranceFee,"Not enough ETH!")
        // 但是存储上述一长串string很消耗gas，所以这里选择存储error code
        if (msg.value < i_entranceFee) {
            revert Raffle__NotEnoughETHEntered();
        } else if (s_raffleState != RaffleState.OPEN) {
            //我们想让这函数只有在state是OPEN的时候才工作
            revert Raffle__NotOpen();
        }
        s_players.push(payable(msg.sender));
        emit RaffleEnter(msg.sender);
    }

    // Chainlink的随机数原理：
    // Request the randgm number
    // 0nce we get it, do something with it
    // 2 transaction process

    /**
     * This is the function that the Chainlink Keeper nodes call
     * they look for `upkeepNeeded` to return True.
     * the following should be true for this to return true:
     * 1. The time interval has passed between raffle runs.
     * 2. The lottery is open, 最少一个player，并且有ETH.
     * 3. The contract has ETH.
     * 4. Implicity, your subscription is funded with LINK.感觉类似给钱才干活的意思
     * 5. The lottery should be in an "open" state.
     *
     * Something that we want to avoid when we're waiting for a random number to return and when we've requested a random winner.
     * We're technically in this weird limbo state where we're waiting for a random number to be returned
     * and we really shouldn't allow any new players to join.
     * So what we actually want to do is create some state variable telling us whether the lottery is open or not
     * and what we're waiting for our random number to get back will be in a closed or calculating state.
     */

    //该函数改成public这样就可以用本合约调用该函数了。
    function checkUpkeep(
        //我们想让这函数只有在state是OPEN的时候才工作，所以在enterRaffle()里也做了限制
        bytes memory /* checkData */
    )
        public
        override
        returns (bool upkeepNeeded, bytes memory /* performData */)
    {
        bool isOpen = RaffleState.OPEN == s_raffleState;
        //1. The time interval has passed between raffle runs.
        // 检查(block.timestamp - last block timestamp) > internal，但上一个块的时间戳我们没有，所以我们要创建一个state variable来记录
        bool timePassed = (block.timestamp - s_lastTimeStamp) > i_interval;
        //2.
        bool hasPlayers = s_players.length > 0;
        bool hasBalance = address(this).balance > 0;

        // 如果upkeepNeeded返回true，意味着是时候得到一个新的随机数random number,end lottery
        upkeepNeeded = (timePassed && isOpen && hasBalance && hasPlayers);
        // We don't use the checkData in this example. The checkData is defined when the Upkeep was registered.
    }

    //external 比 public省gas，因为own contract can't call this
    function performUpkeep(bytes calldata /* performData */) external override {
        //该函数在enterraffle成功后，由keeper运行，并调用成功后call chainlink VRF

        // 之前是想调用VRF文档中requestRandomWords()函数，在keeper这里rename成了performUpkeep()
        // requestId = COORDINATOR.requestRandomWords(//这个函数的参数说明都可以在https://docs.chain.link/vrf/v2/subscription/examples/get-a-random-number#:~:text=The%20parameters%20define,given%20_requestId.找到
        //     keyHash, // bytes32 keyHash: The gas lane key hash value, which is the maximum gas price you are willing to pay for a request in wei. It functions as an ID of the off-chain VRF job that runs in response to requests.
        //     s_subscriptionId, // uint64 s_subscriptionId: The subscription ID that this contract uses for funding requests.
        //     requestConfirmations,
        //     callbackGasLimit,
        //     numWords
        //在上面全部存为state variables

        (bool upkeepNeeded, ) = checkUpkeep(""); //空的calldata
        if (!upkeepNeeded) {
            revert Raffle__UpkeepNotNeeded(
                address(this).balance,
                s_players.length,
                uint256(s_raffleState)
            );
        }
        s_raffleState = RaffleState.CALCULATING; //有人正在请求，此时不允许别人进行请求
        uint256 requestId = i_vrfCoordinator.requestRandomWords( // returns a uint256 request ID
            i_gasLane,
            i_subscriptionId,
            REQUEST_CONFIRMATIONS,
            i_callbackGasLimit,
            NUM_WORDS
        );
        emit RequestedRafflewinner(requestId);
    }

    function fulfillRandomWords(
        uint256 /*requestId,*/,
        uint256[] memory randomWords //只有一个
    ) internal override {
        //VRFConsumerBaseV2.sol会知道要call这个function
        // 它的产生随机数的原理：
        // 给定一个想获得的随机数范围，比如s_playersize=10.
        // 给定一个随机数，比如202.
        // 202 % 10 = 2.
        // 所以最终随机数为2.
        uint256 indexOfWinner = randomWords[0] % s_players.length;
        address payable recentWinner = s_players[indexOfWinner];
        s_recentWinner = recentWinner;
        //我们从player里选出winner后，我们要重新设置player array
        s_players = new address payable[](0);
        //还要重新reset s_lastTimeStamp
        s_lastTimeStamp = block.timestamp;
        s_raffleState = RaffleState.OPEN; //完成了请求，重新改回状态，别也可以请求了
        (bool success, ) = recentWinner.call{value: address(this).balance}("");
        //require(success)
        if (!success) {
            revert Raffle__TransferFailed();
        }
        //接下来要通过emit event来track历史中的winner并保留记录
        emit WinnerPicked(recentWinner);
    }

    /** Getter Functions */

    function getRaffleState() public view returns (RaffleState) {
        return s_raffleState;
    }

    function getNumWords() public pure returns (uint256) {
        return NUM_WORDS; //这东西不是storage也不是链上数据，所以不用view用pure
    }

    function getRequestConfirmations() public pure returns (uint256) {
        return REQUEST_CONFIRMATIONS;
    }

    function getRecentWinner() public view returns (address) {
        return s_recentWinner;
    }

    function getPlayer(uint256 index) public view returns (address) {
        return s_players[index];
    }

    function getLastTimeStamp() public view returns (uint256) {
        return s_lastTimeStamp;
    }

    function getInterval() public view returns (uint256) {
        return i_interval;
    }

    function getEntranceFee() public view returns (uint256) {
        return i_entranceFee;
    }

    function getNumberOfPlayers() public view returns (uint256) {
        return s_players.length;
    }
}
