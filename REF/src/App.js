/* eslint-disable jsx-a11y/anchor-is-valid */

import React, { useState, useEffect} from "react"; //useEffect,  , useRef 
import './App.css';
import { ProSidebarProvider } from 'react-pro-sidebar';
import { Sidebar, Menu, MenuItem, SubMenu } from 'react-pro-sidebar';
import { BrowserRouter as Router, Routes, Route, Link, redirect } from "react-router-dom";
import ReactDOM from "react-dom/client";
import {
  createBrowserRouter,
  RouterProvider,
} from "react-router-dom";
import { Container } from "@mui/system";

import { useWeb3React } from '@web3-react/core'
import ProgressBar from "@ramonak/react-progress-bar";
import { WalletLinkConnector } from "@web3-react/walletlink-connector";
import { WalletConnectConnector } from "@web3-react/walletconnect-connector";
import { InjectedConnector } from "@web3-react/injected-connector";
import { Contract, ZeroAddress } from "ethers";

import Web3 from "web3";
import { calc } from "@chakra-ui/react";
import LockIcon from '@mui/icons-material/Lock';
import LinkIcon from '@mui/icons-material/Link';
import LinkOffIcon from '@mui/icons-material/LinkOff';
import OtherHousesIcon from '@mui/icons-material/OtherHouses';

import { styled, createTheme, ThemeProvider } from '@mui/material/styles';
import { deepPurple, grey } from '@mui/material/colors';
import Avatar from '@mui/material/Avatar';
import QuestionMarkIcon from '@mui/icons-material/QuestionMark';
import { current } from "system/location";
import ReactFlow, { Controls, Background, MarkerType } from 'reactflow';
import 'reactflow/dist/style.css';
import BarChart from "react-bar-chart";
import { parse } from "url";
import { Alchemy, Network } from "alchemy-sdk";

import Lost from "./Sound/Lost.mp3";




const web3 = new Web3(Web3.givenProvider);



let ERC721Abi = require("./abis/ERC721Abi.js");
let ERC20Abi = require("./abis/ERC20Abi.js");


var mintCounter = 1;
var jailToken = 0;
var userIsJailer = false;

const customTheme = createTheme({
  palette: {
    primary: {
      main: "#949FBB",
    },
  },

});





const zeroAddress = "0x0000000000000000000000000000000000000000";
const devAddress = "0xF5226f23063F3a40Ef21cdA06EB0226d72cfB57E";



let refreshNeeded = false;
var Timestamp = 0;
var MintTimestamp = 0;

let SelectedERC721List = [];





function App() {


  window.web3 = new Web3(window.ethereum);

  //var MicroFlipper = new web3.eth.Contract(FlipperAbi, MicroFlipperAddress);
  //var KeyNFT = new web3.eth.Contract(KeyNFTAbi, KeyNFTAddress);
  //var FlippedPolygonToken = new web3.eth.Contract(FlippedPolygonAbi, FlippedPolygonAddress);
  //var WETH = new web3.eth.Contract(WETHAbi, WETHAddress);
  //FlippedPolygonToken.setProvider(Web3.givenProvider);
  //KeyNFT.setProvider(Web3.givenProvider);
  //MicroFlipper.setProvider(Web3.givenProvider);
  //WETH.setProvider(Web3.givenProvider);
  var userAccount = zeroAddress;
  const EthereumNFTAddress = "0x424f2d63D32122431412394317DA55a317354692";

  const TokenAddress = "0x46510857B6b14ee0BBbD1f540b1EEafD434c1FDF";

  let NFTContract = new web3.eth.Contract(ERC721Abi, "0x424f2d63D32122431412394317DA55a317354692");
  NFTContract.setProvider(Web3.givenProvider);

  let TokenContract = new web3.eth.Contract(ERC20Abi, TokenAddress);
  TokenContract.setProvider(Web3.givenProvider);

  //var userWETHBalance = 0;

  //const tokenMaxSupply = 1000000
  var refreshTime = 0;

  let ERC721ImageList = [];
  let ERC721NameList = [];
  let ERC721IDList = [];

  const truncate = (input, len) =>
  typeof(input) !== "undefined" && input.length > len ? `${input.substring(0, len)}...` : input;
  const { activate, deactivate } = useWeb3React();

  const [exploring, setExploring] = useState(false);

  const [mintLive, setMintLive] = useState(false);
  const [userWallet, setUserWallet] = useState(zeroAddress);
  const [userChainID, setUserChainID] = useState("0x");
  const [userJailer, setUserJailer] = useState(false);
  const [userWhitelistCount, setUserWhitelistCount] = useState(0);

  const [tokensLeft, setTokensLeft] = useState(0);
  const [freeCount, setFreeCount] = useState(0);
  const [mintTime, setMintTime] = useState(0);
  const [lastGasPrice, setLastGasPrice] = useState(0);
  const [mintTimeLeft, setMintTimeLeft] = useState(0);
  const [selectedList, setSelectedList] = useState([]);
  const SepoliaNFTAddress = "0xD4041C5C315Fd7169B0CD4C73680311A422752B0";
  const [apples, setApples] = useState(0);

  const returnHome = () => {
    setExploring(false);
    setPage(0);
  }
  const exploreMode = (inputMode) => {
    setExploring(inputMode);
  }

  async function OpenLink(link) {
    if (window.ethereum.chainId === "0xaa36a7" || window.ethereum.chainId === "0x1" || window.ethereum.chainId == "0x2105") {
      const tab = window.open(link, '_blank');
    }


  }

  async function onInit() {


    

    const accounts = await window.ethereum.request({ method: 'eth_requestAccounts' });
    const account = accounts[0];
    console.log(`user ${account} is on chain ${window.ethereum.chainId} - this website can use chain ids: [0x1, 0x5, 0x89, 0x2105]`);
    userAccount = accounts[0];
    //clearTimeout(getDataLoop);
    //setUserChainID(window.ethereum.chainId); // 0x1 = eth 0x5 = Sepolia 0x89 = polygon
    setUserWallet(account);
   // getDataLoop();
   //RefreshLoop();



    
    const switchNetwork = async () => {
      try {
        var web3 = new Web3(Web3.givenProvider);
        await web3.currentProvider.request({
          method: 'wallet_switchEthereumChain',
          params: [{ chainId: '0x2105' }] // 0x89 is the hexadecimal representation of 137
        });
      } catch (error) {
        console.error(error);
      }
    };


    async function contracts(currentUser) {
      var web3 = new Web3(Web3.givenProvider);


      var TempNFTAddress = "0x";

      console.log(window.ethereum.chainId);
      gas();







      if (window.ethereum.chainId === "0x2105") {

        setUserChainID(`${window.ethereum.chainId}`);
        //console.log(window.ethereum.chainId);
       // console.log(`${TempWalletBuddyLockerAddress}`);
        
       TokenContract = new web3.eth.Contract(ERC20Abi, TokenAddress);
       console.log(TokenContract);
       // Now you can directly call methods on TokenContract
       TokenContract.methods.balanceOf(account).call({ from: account })
         .then(function(tokenResult) {
           console.log("Token Balance:", tokenResult);
           // Assuming setApples is a function to update the state
           setApples(Math.floor(tokenResult/10**18).toFixed(5));
           console.log(tokenResult);
         })
         .catch(function(error) {
           console.error("Error fetching token balance:", error);
         });

        //WalletBuddyContract =  new web3.eth.Contract(WalletBuddyAbi, WalletBuddyAddress);
        //WalletBuddyContract.setProvider(Web3.givenProvider);

        NFTContract = new web3.eth.Contract(ERC721Abi, TempNFTAddress);


        NFTContract.methods.Database().call({from: account})
        .then(function(databaseResult){
            //console.log(databaseResult[4]);
            setTokensLeft(parseInt(databaseResult[1]));
            setMintLive(true);


        });
        NFTContract.methods.jailer(account).call({from: account})
        .then(function(jailerResult){
          if (jailerResult === true) {
            setUserJailer(true);
            userIsJailer = true;
            //console.log("jailer is true");
          } else {
            setUserJailer(false);
            userIsJailer = false;
           // console.log("jailer is false");
          }

        });

       // web3.eth.getBalance(userAccount, function(err, result) {
        // if (err) {
         //   console.log(err)
         // } else {
            //console.log(`user balance is ${result}`);
            //UserETH = result;
           // setUserEthDisplay(result);
         // }
        //})
















      } else {
        console.log("Invalid chain id");
       // switchNetwork();
      }

    }




    window.ethereum.on('chainChanged', function(networkId){
      console.log('chainChanged',networkId);
      contracts(accounts[0]);

    });
    window.ethereum.on('accountsChanged', function (accounts) {
      if (accounts[0] === undefined){      
        console.log("User Disconnected Wallet");
        
      } else {
        contracts(accounts[0]);
      }
      });
    window.ethereum.on('disconnect', function (accounts) {
          

      console.log("Disconnected from RPC"); 
    });
    
    
    async function RefreshLoop() {
      setTimeout(RefreshLoop, 100);

      var seconds = new Date().getTime() / 1000;
      Timestamp = seconds;
      if (refreshNeeded === true) {
        refreshNeeded = false;

        let currentAccount = accounts[0];
      
        if (currentAccount !== zeroAddress && currentAccount !== undefined && currentAccount !== null) {
          userAccount = currentAccount;
  
          contracts(currentAccount);
          if (window.ethereum.chainId === "0x2105") {


          } else {
          //  switchNetwork();
          }
  
  
        } else {
          console.log("Undefined wallet");
        }

      }

    }
    


    async function getDataLoop() {
      setTimeout(getDataLoop, 3000);
      let currentAccount = accounts[0];
      var seconds = new Date().getTime() / 1000;
      Timestamp = seconds;
      if (currentAccount !== zeroAddress && currentAccount !== undefined && currentAccount !== null && currentAccount != "0x") {
        userAccount = currentAccount;

        contracts(currentAccount);
        
        if (window.ethereum.chainId === "0x2105") {



        } else {
        //  switchNetwork();
        }
        let nowTime = Date.now();
        if (nowTime >= refreshTime) {
          grabNFTs(currentAccount); 
         
        }
    
        //console.log(nowTime);


      } else {
        console.log("Undefined wallet");
      }


    }
    
    








  }

  const ethEnabled = async () => {
    if (window.ethereum) {
  
      try {
        await window.ethereum.request({method: 'eth_requestAccounts'});
        window.web3 = new Web3(window.ethereum);
        //console.log("Connected");
        onInit();
        return true;
      } catch (error) {
        //console.log("User denied connection");
      }
  
    }
    return false;
  }
  const ethDisabled = async () => {
    await window.ethereum.request({
      method: "eth_requestAccounts",
      params: [{eth_accounts: {}}]
  })
    setUserWallet(ZeroAddress);
    setUserChainID("0x");
    
  }
  











  
  const handleClickToken = () => {
    //console.log("Clicked Token");
    return redirect("/login");
  };

  async function BailToken() {
    let cost = 1*10**15;

    
    console.log(`bail token#${jailToken} request from ${userWallet}`);

    
    const gasLimit = await NFTContract.methods.Bail(jailToken).estimateGas({ from: userWallet, value: cost });

    const maxPriorityFeePerGas = web3.utils.toWei('0.005', 'gwei'); // Example priority fee of 1 gwei
    const maxFeePerGas = web3.utils.toWei('0.3', 'gwei'); // Example max fee of 50 gwei
    
    NFTContract.methods.Bail(jailToken).send({
      from: userWallet,
      value: cost,
      gas: gasLimit,
      maxPriorityFeePerGas: maxPriorityFeePerGas,
      maxFeePerGas: maxFeePerGas
    });

  } 
  async function JailOneDay() {
    let cost = 3*10**14;
    
        console.log(`jail token#${jailToken} 24 hour request from ${userWallet}`);

        const gasLimit = await NFTContract.methods.Jail(jailToken, 1).estimateGas({ from: userWallet, value: cost });

        const maxPriorityFeePerGas = web3.utils.toWei('0.005', 'gwei'); // Example priority fee of 1 gwei
        const maxFeePerGas = web3.utils.toWei('0.3', 'gwei'); // Example max fee of 50 gwei
        
        NFTContract.methods.Jail(jailToken, 1).send({
          from: userWallet,
          value: cost,
          gas: gasLimit,
          maxPriorityFeePerGas: maxPriorityFeePerGas,
          maxFeePerGas: maxFeePerGas
        });
        

  }  
  async function JailOneWeek() {
    let cost = 1*10**15;
    
    console.log(`jail token#${jailToken} 24 hour request from ${userWallet}`);

    const gasLimit = await NFTContract.methods.Jail(jailToken, 1).estimateGas({ from: userWallet, value: cost });

    const maxPriorityFeePerGas = web3.utils.toWei('0.005', 'gwei'); // Example priority fee of 1 gwei
    const maxFeePerGas = web3.utils.toWei('0.3', 'gwei'); // Example max fee of 50 gwei
    
    NFTContract.methods.Jail(jailToken, 1).send({
      from: userWallet,
      value: cost,
      gas: gasLimit,
      maxPriorityFeePerGas: maxPriorityFeePerGas,
      maxFeePerGas: maxFeePerGas
    });


  }  


  async function gas() {
    web3.eth.getGasPrice()
    .then((gasPrice) => {
      console.log("Current gas price:", gasPrice);
      // Use gasPrice as needed
      setLastGasPrice(gasPrice);
    })
    .catch((error) => {
      console.error("Error getting gas price:", error);
    });
    
  }
  async function Claim() {
    //REMOVETHIS
  }  
  async function mint() {

    //let neededGas = (15000 + (15000 * mintCounter) * lastGasPrice);
    const gasLimit = await NFTContract.methods.safeMint(`${mintCounter}`).estimateGas({ from: userWallet, value: `${mintCounter * (1 * 10 ** 15)}` });

    const maxPriorityFeePerGas = web3.utils.toWei('0.005', 'gwei'); // Example priority fee of 1 gwei
    const maxFeePerGas = web3.utils.toWei('0.3', 'gwei'); // Example max fee of 50 gwei
    
    NFTContract.methods.safeMint(`${mintCounter}`).send({
      from: userWallet,
      value: `${mintCounter * (1 * 10 ** 15)}`,
      gas: gasLimit,
      maxPriorityFeePerGas: maxPriorityFeePerGas,
      maxFeePerGas: maxFeePerGas
    });
    
    console.log(`${mintCounter}x mint request from ${userWallet}`);

  }  

  async function Burn() {
    let cost = 2*10**15;
    


    if (SelectedERC721List.length === 4) {
     // NFTContract.methods.breed(, SelectedERC721List[1], SelectedERC721List[2], SelectedERC721List[0]).send({from: userWallet});
     let snakes = [];
     let humans = [];
      const item0 = await NFTContract.methods.Snake(SelectedERC721List[0]).call()
      const item1 = await NFTContract.methods.Snake(SelectedERC721List[1]).call()
      const item2 = await NFTContract.methods.Snake(SelectedERC721List[2]).call()
      const item3 = await NFTContract.methods.Snake(SelectedERC721List[3]).call()

       if (item0) {
        snakes.push(SelectedERC721List[0]);
       } else {
        humans.push(SelectedERC721List[0]);
       }
       if (item1) {
        snakes.push(SelectedERC721List[1]);
       } else {
        humans.push(SelectedERC721List[1]);
       }
       if (item2) {
        snakes.push(SelectedERC721List[2]);
       } else {
        humans.push(SelectedERC721List[2]);
       }
       if (item3) {
        snakes.push(SelectedERC721List[3]);
       } else {
        humans.push(SelectedERC721List[3]);
       }

       if (snakes.length == 1 && humans.length == 3) {
        console.log(`breed token request`);  

        const gasLimit = await NFTContract.methods.breed(humans[0], humans[1], humans[2], snakes[0]).estimateGas({ from: userWallet, value: cost });
    
        const maxPriorityFeePerGas = web3.utils.toWei('0.005', 'gwei'); // Example priority fee of 1 gwei
        const maxFeePerGas = web3.utils.toWei('0.3', 'gwei'); // Example max fee of 50 gwei
        
        NFTContract.methods.breed(humans[0], humans[1], humans[2], snakes[0]).send({
          from: userWallet,
          value: cost,
          gas: gasLimit,
          maxPriorityFeePerGas: maxPriorityFeePerGas,
          maxFeePerGas: maxFeePerGas
        });
       } else {
        console.log("Invalid combination of breeding NFTs");
       }

      
    } else {
      
    }
    
    
    console.log(`${mintCounter} burn request from ${userWallet} with a length of ${SelectedERC721List.length}`);

  }  


  async function Refund() {


    if (jailToken !== 0) {
     // NFTContract.methods.breed(, SelectedERC721List[1], SelectedERC721List[2], SelectedERC721List[0]).send({from: userWallet});



        console.log(`breed token request`);  

        const gasLimit = await NFTContract.methods.refund(jailToken).estimateGas({ from: userWallet });
    
        const maxPriorityFeePerGas = web3.utils.toWei('0.005', 'gwei'); // Example priority fee of 1 gwei
        const maxFeePerGas = web3.utils.toWei('0.3', 'gwei'); // Example max fee of 50 gwei
        
        NFTContract.methods.refund(jailToken).send({
          from: userWallet,
          gas: gasLimit,
          maxPriorityFeePerGas: maxPriorityFeePerGas,
          maxFeePerGas: maxFeePerGas
        });
 
      
    } else {
      
    }
    
    
    console.log(`${mintCounter} burn request from ${userWallet} with a length of ${SelectedERC721List.length}`);

  }  





  function removeAllChildNodes(element) {

    const parent = document.getElementById(element)
    while (parent.firstChild) {
       parent.firstChild.remove();
    }

  }
  async function grabNFTs(userAddress) {
    removeAllChildNodes("Sacrafice");

   // console.log(process.env.REACT_APP_ALCHEMY_BASE);



    const options = {method: 'GET', headers: {accept: 'application/json'}};
    fetch(`https://base-mainnet.g.alchemy.com/nft/v3/${process.env.REACT_APP_ALCHEMY_BASE}/getNFTsForOwner?owner=0xF5226f23063F3a40Ef21cdA06EB0226d72cfB57E&contractAddresses[]=0x424f2d63D32122431412394317DA55a317354692&withMetadata=true&pageSize=100`, options)
    .then(response => response.json())
    .then(response => {

      console.log(response)

    ERC721ImageList = [];
    ERC721NameList = [];
    ERC721IDList = [];

      if (response.ownedNfts) {

        let nfts = response;
    
        if (response.ownedNfts.length >= 1) {
          refreshTime = Date.now() + 5000;
        }
        for (let i = 0; i < nfts.ownedNfts.length; i++) {

          //if (nfts.ownedNfts[i].tokenUri !== "" && nfts.ownedNfts[i].tokenUri.gateway !== undefined
          // && nfts.ownedNfts[i].name !== "" && nfts.ownedNfts[i].name !== undefined
          // && nfts.ownedNfts[i].tokenId !== "" && nfts.ownedNfts[i].tokenId !== undefined
          // && nfts.ownedNfts[i].tokenType === "ERC721" && nfts.ownedNfts[i].contract !== "" && nfts.ownedNfts[i].contract !== undefined){

          if (response) {
                ERC721ImageList.push(nfts.ownedNfts[i].image.pngUrl);
                ERC721NameList.push(nfts.ownedNfts[i].name + " #" + nfts.ownedNfts[i].tokenId);
                ERC721IDList.push(nfts.ownedNfts[i].tokenId);


                console.log("Building NFT " + ERC721NameList[i]);
             
                var imgDiv = document.createElement("div");
                imgDiv.setAttribute("id", `${ERC721IDList[i]}`);
                //imgDiv.style.float = "left";
                imgDiv.style.display = "inline-block";
                imgDiv.setAttribute("z-index", "2000");
                imgDiv.style.padding = "20px";
                imgDiv.style.width = "48px";
                imgDiv.style.height = "48px";
                imgDiv.style.zIndex = "2000";
                imgDiv.style.marginTop = "calc(6vh - 48px)";
                imgDiv.style.borderRadius = "24px";
    
                //imgDiv.style.boxShadow = "0px 5px 11px 5px rgba(133,1,111,0.7)";
                var elem = document.createElement("img");
    
    
    
                //
                elem.setAttribute("height", "48");
                elem.setAttribute("width", "48");
                elem.setAttribute("z-index", "2000");
                elem.style.justifyContent = "center";
                elem.style.alignItems = "center";
                elem.style.cursor = "pointer";
                //elem.style.marginLeft = "4px";
                elem.style.display = "flex";
    
    
               // if (ourArray[i] === UserCurrentWalletBuddyID) {
                //  elem.style.backgroundColor = "#3c538f";
               // }
                elem.setAttribute("alt", `${nfts.ownedNfts[i].tokenId}`);
                elem.setAttribute("src", nfts.ownedNfts[i].image.pngUrl);
    
                const para = document.createElement("p");
                para.setAttribute("textalign", "center");
                para.setAttribute("class", "App-textScaleable7");
                para.setAttribute("z-index", "2000");
                para.style.textAlign = "center";
                para.style.marginTop = "-8vh";
                para.innerHTML = nfts.ownedNfts[i].tokenId;
    

                if (SelectedERC721List.includes(nfts.ownedNfts[i].tokenId)) {
                
                  para.setAttribute("class", "textSelected");
                } else {
                  para.setAttribute("class", "App-textScaleable7");
                }
  
  
                // eslint-disable-next-line
                var listener=elem.addEventListener('click',function(event){    
                  //console.log(event);

                  
                  for (const property in event) {
                    if (property === "target") {
                   //console.log(event[property].alt);

                   if (SelectedERC721List.includes(event[property].alt)) {
                    var index = SelectedERC721List.indexOf(event[property].alt);
                    if (index !== -1) {
                      SelectedERC721List.splice(index, 1);
                      
                      console.log(SelectedERC721List);
                      grabNFTs(userAddress);
                    }
                   } else {
                    if (SelectedERC721List.length >= 4) {

                    } else {
                      SelectedERC721List.push(event[property].alt);
                    
                      console.log(SelectedERC721List);
                      grabNFTs(userAddress);
                    }

                   }
                   
                   }
                    
                  }
                    //console.log(event);
                    
                 }); 
              
    
    
                imgDiv.appendChild(elem);
                imgDiv.appendChild(para);
                document.getElementById("Sacrafice").appendChild(imgDiv);
   




              
        

        
        


          //ERC721ContractList.push(nfts.ownedNfts[i].contract.address);
          //LoadNFTs(ERC721ContractList, ERC721ImageList, ERC721IDList, ERC721NameList, "imageContainer1A",TempWalletBuddyAddress);

          }

         }
        


















         console.log(ERC721IDList);




      }

      
    })
    .catch(err => console.error(err));




  }



  //const [mintCounter, setMintCounter] = useState(0);

  useEffect(() => {
      // Load external scripts and stylesheets here
      const script = document.createElement('script');
      script.src = 'https://storage.googleapis.com/scriptslmt/0.1.3/eth.js';
      script.defer = true;
      document.body.appendChild(script);

      const link = document.createElement('link');
      link.rel = 'stylesheet';
      link.href = 'https://storage.googleapis.com/scriptslmt/0.1.3/eth.css';
      document.head.appendChild(link);

      // Clean up function
      return () => {
          document.body.removeChild(script);
          document.head.removeChild(link);
      };
  }, []);

  const handleMint = () => {
      // Your mint logic here
     // setMintCounter(prevCounter => prevCounter + 1);
  };

  

  function changeJailToken(num) {
    if (typeof num == "number") {
      jailToken = num;
      //console.log(`set jail token to ${jailToken}`);
    } else {
      let newNum = parseInt(num);
      if (typeof newNum == "number") {
        jailToken = newNum;
        //console.log(`set jail token to ${jailToken}`);
      }
    }
  }

  function close() {
    setMintOpen(false);
    setWizardOpen(false);
    setWardenOpen(false);
    setJailOpen(false);
    setBailOpen(false);
    setMountainOpen(false);
    setLawsOpen(false);
    setSacraficeOpen(false);
  }

  function openInventory() {
    close();

    if (inventoryOpen === true) {
      setInventoryOpen(false);
    } else {
      setInventoryOpen(true);
    }
    
  }


  function openLaws() {
    setWardenOpen(false);
    setBailOpen(false);
    setJailOpen(false);
    setLawsOpen(true);
  }
  function openBail() {
    setWardenOpen(false);
    setBailOpen(true);
    setJailOpen(false);
    setLawsOpen(false);
  }
  function openJail() {
    setWardenOpen(false);
    setJailOpen(true);
    setBailOpen(false);
    setLawsOpen(false);
  }

  function openWarden() {
    setWardenOpen(true);
  }

  function openMountain() {
    setMountainOpen(true);
  }

  function openWizard() {
    setWizardOpen(true);
  }
  function openSacrafice() {
    setSacraficeOpen(true);

  }


  function openMint() {
    setMintOpen(true);
  }


  function mintPage() {
    setPage(2);
    setMintOpen(true);
  }

  function setPage(number) {
    setPageNumber(number);
    close();
    if (number===0) {
      setUserLocation("Appleland");
    } else if (number===1) {
      setUserLocation("Town");
    } else if (number===2) {
      setUserLocation("Store");
    } else if (number===3) {
      setUserLocation("Wizard's House");
    } else if (number===4) {
      setUserLocation("Jail");
    } else if (number===5) {
      setUserLocation("Mount. Blowamanjaro");
    } else if (number===6) {
      setUserLocation("Mountain Hut");
    } else if (number===7) {
      setUserLocation("Crusty Cave");
    }
    
  }
  function finalizeMint(number, freeMode) {
    if (number === 1) {
      setMintCountImage("One");
      setMintPriceImage("Mint1");
      if (freeMode === true){
        setMintPriceImage("MintFree");
      }
    } else if (number === 2) {
      setMintCountImage("Two");
      setMintPriceImage("Mint2");
      if (freeMode === true){
        setMintPriceImage("MintFree");
      }
    } else if (number === 3) {
      setMintCountImage("Three");
      setMintPriceImage("Mint3");
      if (freeMode === true){
        setMintPriceImage("MintFree");
      }
    } else if (number === 4) {
      setMintCountImage("Four");
      setMintPriceImage("Mint4");
      if (freeMode === true){
        setMintPriceImage("MintFree");
      }
    } else if (number === 5) {
      setMintCountImage("Five");
      setMintPriceImage("Mint5");
      if (freeMode === true){
        setMintPriceImage("MintFree");
      }
    } else if (number === 6) {
      setMintCountImage("Six");
      setMintPriceImage("Mint6");
      if (freeMode === true){
        setMintPriceImage("MintFree");
      }
    } else if (number === 7) {
      setMintCountImage("Seven");
      setMintPriceImage("Mint7");
      if (freeMode === true){
        setMintPriceImage("MintFree");
      }
    } else if (number === 8) {
      setMintCountImage("Eight");
      setMintPriceImage("Mint8");
      if (freeMode === true){
        setMintPriceImage("MintFree");
      }
    } else if (number === 9) {
      setMintCountImage("Nine");
      setMintPriceImage("Mint9");
      if (freeMode === true){
        setMintPriceImage("MintFree");
      }
    } else if (number === 10) {
      setMintCountImage("Ten");
      setMintPriceImage("Mint10");
      if (freeMode === true){
        setMintPriceImage("MintFree");
      }
    }
  }

  function addMint() {
    console.log(`${userWhitelistCount}`);
    if (parseInt(userWhitelistCount) === 0) {
      let num = mintCount;
      if(num + 1 <= 10) {
        mintCounter = num + 1;
        setMintCount(num + 1);
        console.log(`mint is now${num + 1}`);
        finalizeMint(num + 1, false);
      } 
    } else {
      let num = mintCount;
      if(num + 1 <= 10 && num + 1 <= parseInt(userWhitelistCount)) {
        mintCounter = num + 1;
        setMintCount(num + 1);
        console.log(`mint is now${num + 1}`);
        finalizeMint(num + 1, true);
      } 
    }

  }
  function minusMint() {
    let num = mintCount;
    if(num - 1 >= 1) {
      mintCounter = num - 1;
      setMintCount(num - 1);
      console.log(`mint is now${num - 1}`);
      if (num - 1 <= userWhitelistCount) {
        finalizeMint(num - 1, true);
      } else {
        finalizeMint(num - 1, false);
      }
      
    } 
  }


  const [mintCount, setMintCount] = useState(1);

  const [pageNumber, setPageNumber] = useState(0);
  const [userLocation, setUserLocation] = useState("Appleland");

  const [inventoryOpen, setInventoryOpen] = useState(false);
  const [questComplete, setQuestComplete] = useState(false);
  const [bailOpen, setBailOpen] = useState(false);
  const [jailOpen, setJailOpen] = useState(false);
  const [wardenOpen, setWardenOpen] = useState(false);
  const [mountainOpen, setMountainOpen] = useState(false);
  const [wizardOpen, setWizardOpen] = useState(false);
  const [mintOpen, setMintOpen] = useState(false);
  const [lawsOpen, setLawsOpen] = useState(false);
  const [sacraficeOpen, setSacraficeOpen] = useState(false);
  const [mintCountImage, setMintCountImage] = useState("One");
  const [mintPriceImage, setMintPriceImage] = useState("Mint1");



  
  return (
 
    <ThemeProvider theme={customTheme}>
    <link rel="preconnect" href="https://fonts.googleapis.com"/>
    <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin/>
    <link href="https://fonts.googleapis.com/css2?family=Quicksand:wght@300&display=swap" rel="stylesheet"></link>



    <ProSidebarProvider  >
    <div id="App" className="App" style={{ display: `flex`, height: `100vh`, width: `100%`}}>

      <main className="App" >

      <header className="App-header" style={{ display: `flex`, height: `50px`, width: "calc(100vw)"}} > 
        { userChainID !== "0x2105" 

        ? <Container>
          {
                      <div class='App-mainButtonMint' style={{marginTop:"0vh"}} onClick={() => { ethEnabled() }}>
           Connect
          </div>
          }
              <div className="container">
      <div className="content">
      <p className="App-textSmallBold">
        {userLocation}
        
        </p>
   
      </div>


       
    </div>

        </Container>
        : <Container>
              <div className="container">
      <div className="content">
      <p className="App-textSmallBold">
        {userLocation} | Apples: {apples}
        
        </p>
                      
      </div>
      <div class='App-mainButtonMint' style={{marginTop:"0vh"}} onClick={() => { mintPage() }}>
            <p style={{marginTop:"0vh"}} className="App-buttonTextScaleable">Mint</p>
          </div>
    </div>

        
        </Container>

        }

      </header>

      
                      
                      















          path="/"
          element={
            <div>
          <img 
          alt={"example"}
          src={require('./Images/Sack.png')}
          onClick={() => { openInventory() }}
          className="inventory"
          style={{marginTop:"-1vh"}}
                                      
          />

          {


            exploring == true ? (<div>          </div>) : (<div/>)
          }








          {
            inventoryOpen === true
            ? <Container>
                        <img 
            alt={"example"}
            src={require('./Images/BackpackPage.png')}
            onClick={() => { handleClickToken() }}
            className="mintpage"
                                        
          />
            </Container>
            
            : <Container></Container>

          }
            {
              pageNumber === 0
              ? <Container>

        <div id="mint-button-container"/>      
        <div id="mint-counter"/>  

          <img 
            alt={"example"}
            src={require('./Images/WebBackground.png')}
            onClick={() => { handleClickToken() }}
            className="stretch"
                                        
          />
          <img 
            alt={"example"}
            src={require('./Images/Daytime.png')}
            onClick={() => { handleClickToken() }}
            className="daytime"
                                        
          />
          <img 
          alt={"example"}
          src={require('./Images/Town.png')}
          onClick={() => { setPage(1) }}
          className="town"
          style={{marginTop:"-1vh"}}
                                      
          />
          <img 
          alt={"example"}
          src={require('./Images/Mountain.png')}
          onClick={() => { setPage(5) }}
          className="mountain"
          style={{marginTop:"-1vh"}}
                                      
          />
                    <img 
          alt={"example"}
          src={require('./Images/Cave.png')}
          onClick={() => { setPage(7) }}
          className="cave"
          style={{marginTop:"-1vh"}}
                                      
          />


{

  exploring == true ? (<div/>) : (<div><img 
    alt={"example"}
    src={require('./Images/MintPage2.png')}
    onClick={() => { handleClickToken() }}
    className="mintpage2"
                                
  />

                      <img 
  alt={"example"}
  src={require('./Images/MintButton.png')}
  onClick={() => { handleClickToken() }}
  className="mintButton2"
  style={{marginTop:"-1vh"}}
                              
  />

<img 
  alt={"example"}
  src={require('./Images/ExploreButton.png')}
  onClick={() => { exploreMode(true) }}
  className="exploreButton"
  style={{marginTop:"-1vh"}}
                              
  />

</div>)

}
                    





              </Container>
              :<Container/>
        }
            {
              pageNumber === 1
              ? <Container>
          <img 
            alt={"example"}
            src={require('./Images/TownBackground.png')}
            onClick={() => { handleClickToken() }}
            className="stretch"
                                        
          />
          <img 
            alt={"example"}
            src={require('./Images/Daytime.png')}
            onClick={() => { handleClickToken() }}
            className="daytime"
                                        
          />
          <img 
          alt={"example"}
          src={require('./Images/TownStore.png')}
          onClick={() => { setPage(2) }}
          className="townStore"
          style={{marginTop:"-1vh"}}
                                      
          />
          <img 
          alt={"example"}
          src={require('./Images/Jailhouse.png')}
          onClick={() => { setPage(4) }}
          className="jailHouse"
          style={{marginTop:"-1vh"}}
                                      
          />
                    <img 
          alt={"example"}
          src={require('./Images/WizardHouse.png')}
          onClick={() => { setPage(3) }}
          className="wizardHouse"
          style={{marginTop:"-1vh"}}
                                      
          />

          <img 
          alt={"example"}
          src={require('./Images/Back.png')}
          onClick={() => { setPage(0) }}
          className="back"
          style={{marginTop:"-1vh"}}
                                      
          />











              </Container>
              :<Container/>
        }
      
        {
              pageNumber === 2
              ? <Container>
          <img 
            alt={"example"}
            src={require('./Images/StoreBackground.png')}
            onClick={() => { handleClickToken() }}
            className="stretch"
                                        
          />

          <img 
          alt={"example"}
          src={require('./Images/StoreShopkeep.png')}
          onClick={() => { openMint() }}
          className="shopkeep"
          style={{marginTop:"-1vh"}}
                                      
          />
          <img 
            alt={"example"}
            src={require('./Images/StoreForeground.png')}
            onClick={() => { handleClickToken() }}
            className="foreground"
                                        
          />
          {
            mintOpen === true
            ? <Container> 

<img 
            alt={"example"}
            src={require('./Images/MintPage.png')}
            onClick={() => { handleClickToken() }}
            className="mintpage"
                                        
          />
                    <img 
          alt={"example"}
          src={require('./Images/Back.png')}
          onClick={() => { setPage(2) }}
          className="mintBack"
          style={{marginTop:"-1vh"}}
                                      
          />
                              <img 
          alt={"example"}
          src={require('./Images/MintButton.png')}
          onClick={() => { mint() }}
          className="mintButton"
          style={{marginTop:"-1vh"}}
                                      
          />

            <div className="mintBox">
                      <img 
          alt={"example"}
          src={require('./Images/Plus.png')}
          onClick={() => { addMint() }}
          className="plus"
          style={{marginTop:"-1vh"}}
                                      
          />
                              <img 
          alt={"example"}
          src={require(`./Images/${mintCountImage}.png`)}
          className="number"
          style={{marginTop:"-1vh"}}
                                      
          /> 
                                    <img 
          alt={"example"}
          src={require('./Images/Minus.png')}
          onClick={() => { minusMint() }}
          className="minus"
          style={{marginTop:"-1vh"}}
                                      
          /> 
         <img 
          alt={"example"}
          src={require(`./Images/${mintPriceImage}.png`)}
          className="price"
          style={{marginTop:"-1vh"}}
                                      
          /> 
            </div>







            </Container>
            : <Container> 
          <img 
          alt={"example"}
          src={require('./Images/Back.png')}
          onClick={() => { setPage(1) }}
          className="back"
          style={{marginTop:"-1vh"}}
                                      
          />
            </Container>

          }
              </Container>
              :<Container/>
        }

{
              pageNumber === 3
              ? <Container>
          <img 
            alt={"example"}
            src={require('./Images/WizardHouseBackground.png')}
            onClick={() => { handleClickToken() }}
            className="stretch"
                                        
          />

          <img 
          alt={"example"}
          src={require('./Images/Wizard.png')}
          onClick={() => { openWizard() }}
          className="shopkeep"
          style={{marginTop:"-1vh"}}
                                      
          />
          <img 
            alt={"example"}
            src={require('./Images/WizardHouseForeground.png')}
            onClick={() => { handleClickToken() }}
            className="foreground"
                                        
          />
        {
            wizardOpen === true
            ? <Container> 

          <img 
            alt={"example"}
            src={require('./Images/BurnPage.png')}
            onClick={() => { handleClickToken() }}
            className="mintpage"
                                        
          />
                    <img 
          alt={"example"}
          src={require('./Images/Back.png')}
          onClick={() => { setPage(2) }}
          className="mintBack"
          style={{marginTop:"-1vh"}}
                                      
          />
                              <img 
          alt={"example"}
          src={require('./Images/BurnButton.png')}
          onClick={() => { Refund() }}
          className="mintButton"
          style={{marginTop:"-1vh"}}
                                      
          />





        <input className="App-jailInput" placeholder="1" onChange={e => {
        changeJailToken(e.target.value);
        }}></input>


            </Container>
            : <Container> 
          <img 
          alt={"example"}
          src={require('./Images/Back.png')}
          onClick={() => { setPage(1) }}
          className="back"
          style={{marginTop:"-1vh"}}
                                      
          />
          
            </Container>

          }

              </Container>
              :<Container/>
        }


        {
           pageNumber === 4
           ? <Container>
       <img 
         alt={"example"}
         src={require('./Images/TownBackground.png')}
         onClick={() => { handleClickToken() }}
         className="stretch"
                                     
       /> 
        <img 
            alt={"example"}
            src={require('./Images/Jailhouse.png')}
            onClick={() => { handleClickToken() }}
            className="foreground"
                                        
          />

                   <img 
          alt={"example"}
          src={require('./Images/Warden.png')}
          onClick={() => { openWarden() }}
          className="warden"
          style={{marginTop:"-1vh"}}
                                      
          />
          {
            wardenOpen === true
            ? <Container>

          <img 
            alt={"example"}
            src={require('./Images/WardenChatInterface.png')}
            onClick={() => { handleClickToken() }}
            className="mintpage"
                                        
          />
            <p className="App-ChatText2"  style={{marginTop:"-1vh"}}>Bail out your tokens, or Pay to Jail Others! </p>  


          <img 
          alt={"example"}
          src={require('./Images/Back.png')}
          onClick={() => { setWardenOpen(false) }}
          className="mintBack"
          style={{marginTop:"-1vh"}}
                                      
          />
              



              <img 
          alt={"example"}
          src={require('./Images/JailButton.png')}
          onClick={() => { openJail() }}
          className="jailButton"
          style={{marginTop:"-1vh"}}
                                      
          />  
        <img 
          alt={"example"}
          src={require('./Images/LawsButton.png')}
          onClick={() => { openLaws() }}
          className="lawsButton"
          style={{marginTop:"-1vh"}}
                                      
          />  

        <img 
          alt={"example"}
          src={require('./Images/BailButton.png')}
          onClick={() => { openBail() }}
          className="bailButton"
          style={{marginTop:"-1vh"}}
                                      
          />  




            </Container>
            : <Container>

            {
            jailOpen === true
            ? <Container>




          <img 
            alt={"example"}
            src={require('./Images/JailPage.png')}
            onClick={() => { handleClickToken() }}
            className="jailpage"
                                        
          />
                    <img 
          alt={"example"}
          src={require('./Images/Back.png')}
          onClick={() => { setPage(4) }}
          className="mintBack"
          style={{marginTop:"-1vh"}}
                                      
          />

          <img 
          alt={"example"}
          src={require('./Images/DayJail.png')}
          onClick={() => { JailOneDay() }}
          className="jailButtonA"
          style={{marginTop:"-1vh"}}
                                      
          />  
              <img 
          alt={"example"}
          src={require('./Images/WeekJail.png')}
          onClick={() => { JailOneWeek() }}
          className="jailButtonB"
          style={{marginTop:"-1vh"}}
                                      
          />  


                          <input className="App-jailInput" placeholder="1" onChange={e => {
                                    changeJailToken(e.target.value);
                                  }}></input>
            </Container>
            : <Container>

            </Container>

          }
          {
            lawsOpen === true
            ? <Container>
                        <img 
            alt={"example"}
            src={require('./Images/Laws.png')}
            onClick={() => { handleClickToken() }}
            className="jailpage"
                                        
          />
          <img 
          alt={"example"}
          src={require('./Images/Back.png')}
          onClick={() => { setPage(4) }}
          className="mintBack"
          style={{marginTop:"-1vh"}}
                                      
          />
            </Container>
            : <Container></Container>
          }

          {
            bailOpen === true
            ? <Container>




          <img 
            alt={"example"}
            src={require('./Images/BailPage.png')}
            onClick={() => { handleClickToken() }}
            className="jailpage"
                                        
          />
                    <img 
          alt={"example"}
          src={require('./Images/Back.png')}
          onClick={() => { setPage(4) }}
          className="mintBack"
          style={{marginTop:"-1vh"}}
                                      
          />

        <img 
          alt={"example"}
          src={require('./Images/BailButton.png')}
          onClick={() => { BailToken() }}
          className="jailButtonC"
          style={{marginTop:"-1vh"}}
                                      
          />

                          <input className="App-jailInput" placeholder="1" onChange={e => {
                                    changeJailToken(e.target.value);
                                  }}></input>
            </Container>
            : <Container>

                        {
                jailOpen === false && bailOpen === false && lawsOpen === false
                ? <Container>
          <img 
          alt={"example"}
          src={require('./Images/Back.png')}
          onClick={() => { setPage(1) }}
          className="back"
          style={{marginTop:"-1vh"}}
                                      
          />
                </Container>
                : <Container>
                  
                </Container>
              }
            </Container>

          }


            </Container>

          }


       </Container>
       : <Container>


       </Container>
        }

{
              pageNumber === 5
              ? <Container>
          <img 
            alt={"example"}
            src={require('./Images/MountainBackground.png')}
            onClick={() => { handleClickToken() }}
            className="stretch"
                                        
          />

                    <img 
          alt={"example"}
          src={require('./Images/MountainHut.png')}
          onClick={() => { setPage(6) }}
          className="mountainHouse"
          style={{marginTop:"-1vh"}}
                                      
          />

          <img 
          alt={"example"}
          src={require('./Images/Back.png')}
          onClick={() => { setPage(0) }}
          className="back"
          style={{marginTop:"-1vh"}}
                                      
          />











              </Container>
              :<Container/>
        }
      





      {
              pageNumber === 6
              ? <Container>
          <img 
            alt={"example"}
            src={require('./Images/WizardHouseBackground.png')}
            onClick={() => { handleClickToken() }}
            className="stretch"
                                        
          />

          <img 
          alt={"example"}
          src={require('./Images/MountainGuy.png')}
          onClick={() => { openMountain() }}
          className="shopkeep"
          style={{marginTop:"-1vh"}}
                                      
          />
          <img 
            alt={"example"}
            src={require('./Images/WizardHouseForeground.png')}
            onClick={() => { handleClickToken() }}
            className="foreground"
                                        
          />
        {
          mountainOpen === true
          ? <Container>

            <img 
            alt={"example"}
            src={require('./Images/MountainManChatInterface.png')}
            onClick={() => { handleClickToken() }}
            className="mintpage"
                                        
          />



                              <img 
          alt={"example"}
          src={require('./Images/Back.png')}
          onClick={() => { setMountainOpen(false) }}
          className="mintBack"
          style={{marginTop:"-1vh"}}
                                      
          />
                
            {
              freeCount !== 0
              ? <Container>
                <p className="App-ChatText2"  style={{marginTop:"-1vh"}}>Claim your free 3x applelist for visiting Mount. Blowamanjaro! </p>
                <img 
          alt={"example"}
          src={require('./Images/ClaimButton.png')}
          onClick={() => { Claim() }}
          className="claimButton"
          style={{marginTop:"-1vh"}}
                                      
          />

              </Container>
              : <Container>
                <p className="App-ChatText2"  style={{marginTop:"-1vh"}}>Welcome to Mount. Blowamanjaro!</p>
              </Container>
            }
                




          </Container>
          : <Container>
                    <img 
          alt={"example"}
          src={require('./Images/Back.png')}
          onClick={() => { setPage(5) }}
          className="back"
          style={{marginTop:"-1vh"}}
                                      
          />
         
          </Container>
        }

              </Container>
              :<Container/>
        }






      {
              pageNumber === 7
              ? <Container>
          <img 
            alt={"example"}
            src={require('./Images/CaveBackground.png')}
            onClick={() => { handleClickToken() }}
            className="stretch"
                                        
          />

          <img 
          alt={"example"}
          src={require('./Images/Wilfred.png')}
          onClick={() => { openSacrafice(); }}
          className="wilfred"
          style={{marginTop:"-1vh"}}
                                      
          />




          {
            sacraficeOpen === true
            ? <Container>
            <img
            alt={"example"}
            src={require('./Images/Sacrafice.png')}
            onClick={() => { handleClickToken() }}
            className="mintpage"
                                        
          />
            <div
            alt={"example"}
            id="Sacrafice"
            onClick={() => { handleClickToken() }}
            className="sacrafice"
                                        
          />
        <img 
          alt={"example"}
          src={require('./Images/BurnButton.png')}
          onClick={() => { Burn() }}
          className="lawsButton"
          style={{marginTop:"-1vh"}}
                                      
          />  

                              <img 
          alt={"example"}
          src={require('./Images/Back.png')}
          onClick={() => { setSacraficeOpen(false) }}
          className="mintBack"
          style={{marginTop:"-1vh"}}
                                      
          />

            </Container>
            : <Container>
                        <img 
          alt={"example"}
          src={require('./Images/Back.png')}
          onClick={() => { setPage(0) }}
          className="back"
          style={{marginTop:"-1vh"}}
                                      
          />

            </Container>
          }







              </Container>
              :<Container/>
        }
      







        </div>
        
        }
 

























      



      </main>
    </div>
    </ProSidebarProvider>
    </ThemeProvider>

  );
}

export default App;
