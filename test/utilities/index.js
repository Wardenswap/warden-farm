const { ethers } = require ('ethers')

function encodeParameters(types, values) {
  const abi = new ethers.utils.AbiCoder()
  return abi.encode(types, values)
}

module.exports = {
  encodeParameters
}
