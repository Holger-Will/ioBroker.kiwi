const path = require("node:path");
const { tests } = require("@iobroker/testing");
const { expect } = require("chai");

// Run tests
tests.integration(path.join(__dirname, ".."), {
	// If the adapter may call process.exit during startup, define here which exit codes are allowed.
	// By default, termination during startup is not allowed.
	allowedExitCodes: [11],

	// Always test against the latest js-controller
	controllerVersion: "latest",

	defineAdditionalTests({ suite }) {
		suite("Startup without API key", (getHarness) => {
			let harness;
			before(() => {
				harness = getHarness();
			});

			it("starts, keeps running and reports not connected", async function () {
				this.timeout(60000);
				await harness.startAdapterAndWait();
				// give onReady time to finish
				await new Promise((resolve) => setTimeout(resolve, 5000));

				expect(harness.isAdapterRunning()).to.equal(true);
				const state = await harness.states.getStateAsync("kiwi.0.info.connection");
				expect(state && state.val).to.equal(false);
			});
		});
	},
});
