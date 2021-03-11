const { assert } = require("chai");

const WardenToken = artifacts.require('WardenToken');

contract('WardenToken', ([alice, bob, carol, dev, minter]) => {
    beforeEach(async () => {
        this.warden = await WardenToken.new({ from: minter });
    });


    it('mint', async () => {
        await this.warden.mint(alice, 1000, { from: minter });
        assert.equal((await this.warden.balanceOf(alice)).toString(), '1000');
    })
});
