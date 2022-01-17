import ethers from 'ethers';
import express from 'express';
import chalk from 'chalk';
import dotenv from 'dotenv';
import inquirer from 'inquirer';

const app = express();
dotenv.config();

const data = {
  BNB: process.env.BNB_CONTRACT, // BNB 合约地址
  to_PURCHASE: process.env.TO_PURCHASE, // 目标合约地址
  AMOUNT_OF_BNB : process.env.AMOUNT_OF_BNB, // 购买的BNB数量

  factory: process.env.FACTORY,  // PancakeSwap V2 factory
  router: process.env.ROUTER, // PancakeSwap V2 router

  recipient: process.env.YOUR_ADDRESS, //your wallet address,

  Slippage : process.env.SLIPPAGE, // 滑点

  gasPrice : ethers.utils.parseUnits(`${process.env.GWEI}`, 'gwei'), // 单位gwei
  gasLimit : process.env.GAS_LIMIT, // 至少 21000

  minBnb : process.env.MIN_LIQUIDITY_ADDED // 流动性池子最小值，若流动性小于设定则停止购买，默认0.1
}

let initialLiquidityDetected = false;
let jmlBnb = 0;

const wss = process.env.WSS_NODE;
const mnemonic = process.env.YOUR_MNEMONIC //your memonic;
const tokenIn = data.BNB;
const tokenOut = data.to_PURCHASE;
// const provider = new ethers.providers.JsonRpcProvider(bscMainnetUrl)
const provider = new ethers.providers.WebSocketProvider(wss);
const wallet = new ethers.Wallet(mnemonic);
const account = wallet.connect(provider);


const factory = new ethers.Contract(
  data.factory,
  [
    'event PairCreated(address indexed token0, address indexed token1, address pair, uint)',
    'function getPair(address tokenA, address tokenB) external view returns (address pair)'
  ],
  account
);

const router = new ethers.Contract(
  data.router,
  [
    'function getAmountsOut(uint amountIn, address[] memory path) public view returns (uint[] memory amounts)',
    'function swapExactTokensForTokens(uint amountIn, uint amountOutMin, address[] calldata path, address to, uint deadline) external returns (uint[] memory amounts)',
    'function swapExactTokensForTokensSupportingFeeOnTransferTokens(uint amountIn, uint amountOutMin, address[] calldata path, address to, uint deadline) external returns (uint[] memory amounts)',
    'function swapETHForExactTokens(uint amountOut, address[] calldata path, address to, uint deadline) external  payable returns (uint[] memory amounts)',
    'function swapExactETHForTokens( uint amountOutMin, address[] calldata path, address to, uint deadline) external payable returns (uint[] memory amounts)',
  ],
  account
);

const erc = new ethers.Contract(
  data.BNB,
  [{"constant": true,"inputs": [{"name": "_owner","type": "address"}],"name": "balanceOf","outputs": [{"name": "balance","type": "uint256"}],"payable": false,"type": "function"}],
  account
);

const run = async () => {
    if (process.env.CHECK_LIQUIDITY === "1" || process.env.CHECK_LIQUIDITY === 1) {
      // 需要检测流动性
      await checkLiq();
    } else {
      console.log(chalk.red("跳过流动性检测"))
      setTimeout(() => buyAction(), 1);
    }
}

  let checkLiq = async() => {
    const pairAddressx = await factory.getPair(tokenIn, tokenOut);
    console.log(chalk.blue(`流动性交易对检测成功: ${pairAddressx}`));
    if (pairAddressx !== null && pairAddressx !== undefined) {
      // console.log("pairAddress.toString().indexOf('0x0000000000000')", pairAddress.toString().indexOf('0x0000000000000'));
      if (pairAddressx.toString().indexOf('0x0000000000000') > -1) {
        console.log(chalk.blue(`流动性：${pairAddressx}未检测成功，自动重启中`));
        return await run();
      }
    }
    const pairBNBvalue = await erc.balanceOf(pairAddressx);
    jmlBnb = await ethers.utils.formatEther(pairBNBvalue);
    if (parseInt(jmlBnb) === 0) {
      console.log(chalk.red(`流动性未添加`));
    } else {
      console.log(`流动性: ${jmlBnb} BNB`);
    }


    if(parseFloat(jmlBnb) > parseFloat(data.minBnb)){
        buyAction()
    }
    else{
        initialLiquidityDetected = false;
        console.log('轮询检测中');
        return await run();
      }

  }

  let buyAction = async() => {
    if(initialLiquidityDetected === true) {
      console.log('not buy cause already buy');
        return null;
    }

    try{
      initialLiquidityDetected = true;

      let amountOutMin = 0;
      //We buy x amount of the new token for our bnb
      const amountIn = ethers.utils.parseUnits(`${data.AMOUNT_OF_BNB}`, 'ether');
      if ( parseInt(data.Slippage) !== 0 ){
        const amounts = await router.getAmountsOut(amountIn, [tokenIn, tokenOut]);
        //Our execution price will be a bit different, we need some flexibility
        amountOutMin = amounts[1].sub(amounts[1].div(`${data.Slippage}`))
      }

      console.log('交易处理中......');
      console.log('============================================================');
      console.log(chalk.green(`BNB数量: ${(amountIn * 1e-18).toString()} BNB`))
      console.log(chalk.green(`目标Token: ${amountOutMin} (合约地址：${tokenOut})`))
      console.log(chalk.green(`滑点: ${data.Slippage}%`));
      console.log(chalk.green(`gasLimit: ${data.gasLimit}`));
      console.log(chalk.green(`gasPrice: ${data.gasPrice / 1000000000} GWEI`));
      console.log('============================================================');

      // const tx = await router.swapExactTokensForTokensSupportingFeeOnTransferTokens( //uncomment this if you want to buy deflationary token
      const tx = await router.swapExactETHForTokens( //uncomment here if you want to buy token
        amountOutMin,
        [tokenIn, tokenOut],
        data.recipient,
        Date.now() + 1000 * 60, // 1 minutes
        {
          'gasLimit': data.gasLimit,
          'gasPrice': data.gasPrice,
          'nonce' : null, //set you want buy at where position in blocks
          'value' : amountIn
      });

      const receipt = await tx.wait();
      console.log(`交易成功，请前往bscscan查看: https://www.bscscan.com/tx/${receipt.logs[1].transactionHash}`);
      setTimeout(() => {process.exit()},2000);
    }catch(err){
      let error = JSON.parse(JSON.stringify(err));
        console.log(chalk.red("交易发生错误"))
        console.log(chalk.red(`原因：${error.reason}`))
        console.log(chalk.red(`交易哈希：${error.transactionHash}`))
        console.log(chalk.red(`信息：${error.code}`))

        inquirer.prompt([
    {
      type: 'confirm',
      name: 'runAgain',
      message: '是否重启？',
    },
  ])
  .then(answers => {
    if(answers.runAgain === true){
      console.log('= = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = =');
      console.log('重启');
      console.log('= = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = =');
      initialLiquidityDetected = false;
      run();
    }else{
      process.exit();
    }

  });

    }
  }

run();

const PORT = 5001;

app.listen(PORT, console.log(chalk.blue(`提供的合约地址为：${data.to_PURCHASE}`)));
