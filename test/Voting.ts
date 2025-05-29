import {
  time,
  loadFixture,
} from "@nomicfoundation/hardhat-toolbox/network-helpers";
import { anyValue } from "@nomicfoundation/hardhat-chai-matchers/withArgs";
import { expect } from "chai";
import hre from "hardhat";
const { ethers } = require("hardhat");
import { BN } from "ethereumjs-util";
import { Voting } from "../typechain-types";

describe("Voting", function () {
  async function deployVotingFixture() {
    const [owner, account1, account2, account3] = await hre.ethers.getSigners();

    const Voting = await hre.ethers.getContractFactory("Voting");
    // First address is normally the owner but we make it explicit for the test
    const voting = await Voting.connect(owner).deploy();
    return { voting, owner, account1, account2, account3 };
  }

  async function deployVotingFixtureWith1Voter() {
    const {voting, owner, account1, account2, account3  } = await loadFixture(
      deployVotingFixture
    );

    await voting.addVoter(account1.address);

    return {voting, owner, voter1: account1, account2, account3 };
  }

  async function deployVotingFixtureReadyToVote() {
    const {voting, owner, voter1, account2, account3  } = await loadFixture(
      deployVotingFixtureWith1Voter
    );
    await voting.addVoter(account2.address);
    await voting.addVoter(account3.address);
    await voting.startProposalsRegistering();
    await voting.connect(voter1).addProposal("Proposal 1");
    await voting.connect(account2).addProposal("Proposal 2");
    await voting.endProposalsRegistering();
    await voting.startVotingSession();

    return {voting, owner, voter1, account2, account3 };
  }

  describe("Deployment", function () {
    it("Should set the right owner", async function () {
      const { voting, owner } = await loadFixture(deployVotingFixture);

      expect(await voting.owner()).to.equal(owner.address);
    });

    it("Should be initialized with default states", async function () {
      const { voting } = await loadFixture(deployVotingFixture);

      expect(await voting.winningProposalID()).to.equal(0);
      expect(await voting.workflowStatus()).to.equal(0);

      // Check if proposalsArray is empty by checking its storage slot #2
      const storage = await ethers.provider.getStorage(
        voting.target,
        2
      );

      expect(storage).to.be.equal(new BN(0));

      // Check if voters mapping is empty by checking its storage slot #3
      const votersStorage = await ethers.provider.getStorage(
        voting.target,
        3
      );
      expect(votersStorage).to.be.equal(new BN(0));
    });
  });

  describe("Add Voter", function () {
    it("Should add voter", async function () {
      const { voting, account1 } = await loadFixture(deployVotingFixture);

      const voterAddress = account1.address;
      await voting.addVoter(voterAddress);
      const voter = await voting.connect(account1).getVoter(voterAddress)

      expect(voter.isRegistered).to.be.true;
    });

    it("Should revert when add twice", async function () {
      const { voting, voter1 } = await loadFixture(deployVotingFixtureWith1Voter);
      await expect(
        voting.addVoter(voter1.address)
      ).to.be.revertedWith('Already registered');
    })

    it("Should revert when add voter in wrong state (Status != RegisteringVoters)", async function () {
      const { voting, account1 } = await loadFixture(deployVotingFixture);
      await voting.startProposalsRegistering();
      await expect(
        voting.addVoter(account1.address)
      ).to.be.revertedWith('Voters registration is not open yet');
    })

    it("Should emit event: VoterRegistered", async function () {
      const { voting, account1 } = await loadFixture(deployVotingFixture);
      await expect(
        voting.addVoter(account1.address)
      ).to.emit(voting, "VoterRegistered").withArgs(account1.address);
    })
  })

  describe("Add Proposals", function () {
    let voting: Voting;
    let voter1: any;

    beforeEach(async function () {
      const { voting: _voting, voter1: _voter1 } = await loadFixture(deployVotingFixtureWith1Voter);
      voting = _voting;
      voter1 = _voter1;

      await voting.startProposalsRegistering();
    })

    it("Genesis proposal should be added at index 0", async function () {
      const proposal = await voting.connect(voter1).getOneProposal(0);
      expect(proposal.description).to.equal("GENESIS");
      expect(proposal.voteCount).to.equal(0);
    })

    it("Should add proposal", async function () {
      // Get the length of the proposals array before adding a new proposal
      const proposalsLength = await ethers.provider.getStorage(
        voting.target,
        2
      );
      const currentIndex = parseInt(proposalsLength) - 1;

      await voting.connect(voter1).addProposal("Proposal 1");
      const proposal = await voting.connect(voter1).getOneProposal(currentIndex + 1);
      expect(proposal.description).to.equal("Proposal 1");
      expect(proposal.voteCount).to.equal(0);
    })

    it("Should revert when add proposal with empty description", async function () {
      await expect(
        voting.connect(voter1).addProposal("")
      ).to.be.revertedWith("Vous ne pouvez pas ne rien proposer");
    })

    it("Should emit event: ProposalRegistered", async function() {
      // Get the length of the proposals array before adding a new proposal
      const proposalsLength = await ethers.provider.getStorage(
        voting.target,
        2
      );
      const currentIndex = parseInt(proposalsLength) - 1;

      await expect(
        voting.connect(voter1).addProposal("Proposal 1")
      ).to.emit(voting, "ProposalRegistered").withArgs(currentIndex + 1);
    })

    it("Should revert when add proposal in wrong state (Status != ProposalsRegistrationStarted)", async function () {
      await voting.endProposalsRegistering();

      await expect(
        voting.connect(voter1).addProposal("Proposal 1")
      ).to.be.revertedWith("Proposals are not allowed yet");
    })
  })

  describe("Set Vote", function () {
    let voting: Voting;
    let voter1: any;
    let voter2: any;

    beforeEach(async function () {
      const { voting: _voting, voter1: _voter1, account2 } = await loadFixture(deployVotingFixtureWith1Voter);
      voting = _voting;
      voter1 = _voter1;
      voter2 = account2;

      await voting.addVoter(voter2.address);
      await voting.startProposalsRegistering();
      await voting.connect(voter1).addProposal("Proposal 1");
      await voting.endProposalsRegistering();
      await voting.startVotingSession();
    })

    it("Should register a new vote", async function () {
      await voting.connect(voter1).setVote(1);
      const voter = await voting.connect(voter1).getVoter(voter1.address);
      expect(voter.hasVoted).to.be.true;
      expect(voter.votedProposalId).to.equal(1);
    })

    it("Should revert when voting twice", async function () {
      await voting.connect(voter1).setVote(1);
      await expect(
        voting.connect(voter1).setVote(1)
      ).to.be.revertedWith("You have already voted");
    })
    
    it("Should revert when voting for invalid proposal", async function () {
      await expect(
        voting.connect(voter2).setVote(100)
      ).to.be.revertedWith("Proposal not found");
    })

    it("Should revert when voting in wrong state (Status != VotingSessionStarted)", async function () {
      await voting.endVotingSession();

      await expect(
        voting.connect(voter1).setVote(1)
      ).to.be.revertedWith("Voting session havent started yet");
    })

    it("Should emit event: Voted", async function () {
      const voteId = 1;
      await expect(
        voting.connect(voter1).setVote(voteId)
      ).to.emit(voting, "Voted").withArgs(voter1.address, voteId);
    })
  })

  // TODO: Tally Votes
  describe("Tally Votes", function () {
    let voting: Voting;
    let owner: any;
    let voter1: any;
    let voter2: any;
    let voter3: any;

    beforeEach(async function () {
      const { voting: _voting, owner: _owner, voter1: _voter1 , account2, account3 } = await loadFixture(deployVotingFixtureReadyToVote);
      voting = _voting;
      owner = _owner;
      voter1 = _voter1;
      voter2 = account2;
      voter3 = account3;

      await voting.connect(voter1).setVote(1);
      await voting.connect(voter2).setVote(2);
      await voting.connect(voter3).setVote(2);
    })

    it("Should tally votes", async function () {
      await voting.endVotingSession();
      await voting.tallyVotes();
      const winningProposal = await voting.winningProposalID();
      expect(winningProposal).to.equal(2);
    })

    it("Should revert when tallying votes in wrong state (Status != VotingSessionEnded)", async function () {
      await expect(
        voting.tallyVotes()
      ).to.be.revertedWith("Current status is not voting session ended");
    })

    it("Should emit event: WorkflowStatusChange", async function () {
      await voting.endVotingSession();
      await expect(
        voting.tallyVotes()
      ).to.emit(voting, "WorkflowStatusChange").withArgs(4, 5); // 4 = VotingSessionEnded, 5 = VotesTallied
    })

    
  })

  // TODO: Test all the workflow status transitions
  describe("Workflow Status", function () {
    let voting: Voting;
    let owner: any;

    beforeEach(async function () {
      const { voting: _voting, owner: _owner} = await loadFixture(deployVotingFixture);
      voting = _voting;
      owner = _owner;

      // Add owner as voter to access onlyVoters function
      await voting.addVoter(owner.address);
    })

    describe("startProposalsRegistering", function () {
      it("Should change status to ProposalsRegistrationStarted", async function () {
        const currentStatus = Number(await voting.workflowStatus())

        await voting.startProposalsRegistering();
        expect(await voting.workflowStatus()).to.equal(currentStatus + 1);
      })

      it("Should revert when not in RegisteringVoters state", async function () {
        await voting.startProposalsRegistering();
        await expect(
          voting.startProposalsRegistering()
        ).to.be.revertedWith("Registering proposals cant be started now");
      })

      it("Should emit event: WorkflowStatusChange", async function () {
        const currentStatus = Number(await voting.workflowStatus())
        await expect(
          voting.startProposalsRegistering()
        ).to.emit(voting, "WorkflowStatusChange").withArgs(currentStatus, currentStatus + 1);
      })

      it("Should add GENESIS proposal", async function () {
        await voting.startProposalsRegistering();
        const proposal = await voting.getOneProposal(0);
        expect(proposal.description).to.equal("GENESIS");
      })
    })

    // TODO: endProposalsRegistering
    describe("endProposalsRegistering", function () {
      beforeEach(async function () {
        await voting.startProposalsRegistering();
      })

      it("Should change status to ProposalsRegistrationEnded", async function () {
        const currentStatus = Number(await voting.workflowStatus())
        await voting.endProposalsRegistering();
        expect(await voting.workflowStatus()).to.equal(currentStatus + 1);
      })

      it("Should revert when not in ProposalsRegistrationStarted state", async function () {
        await voting.endProposalsRegistering();
        await expect(
          voting.endProposalsRegistering()
        ).to.be.revertedWith("Registering proposals havent started yet");
      })

      it("Should emit event: WorkflowStatusChange", async function () {
        const currentStatus = Number(await voting.workflowStatus())
        await expect(
          voting.endProposalsRegistering()
        ).to.emit(voting, "WorkflowStatusChange").withArgs(currentStatus, currentStatus + 1);
      })
    })
    // TODO: startVotingSession
    describe("startVotingSession", function () {
      beforeEach(async function () {
        await voting.startProposalsRegistering();
        await voting.endProposalsRegistering();
      })

      it("Should change status to VotingSessionStarted", async function () {
        const currentStatus = Number(await voting.workflowStatus())
        await voting.startVotingSession();
        expect(await voting.workflowStatus()).to.equal(currentStatus + 1);
      })

      it("Should revert when not in ProposalsRegistrationEnded state", async function () {
        await voting.startVotingSession();
        await expect(
          voting.startVotingSession()
        ).to.be.revertedWith("Registering proposals phase is not finished");
      })

      it("Should emit event: WorkflowStatusChange", async function () {
        const currentStatus = Number(await voting.workflowStatus())
        await expect(
          voting.startVotingSession()
        ).to.emit(voting, "WorkflowStatusChange").withArgs(currentStatus, currentStatus + 1);
      })
    })

    describe("endVotingSession", function () {
      beforeEach(async function () {
        await voting.startProposalsRegistering();
        await voting.endProposalsRegistering();
        await voting.startVotingSession();
      })

      it("Should change status to VotingSessionEnded", async function () {
        const currentStatus = Number(await voting.workflowStatus())
        await voting.endVotingSession();
        expect(await voting.workflowStatus()).to.equal(currentStatus + 1);
      })

      it("Should revert when not in VotingSessionStarted state", async function () {
        await voting.endVotingSession();
        await expect(
          voting.endVotingSession()
        ).to.be.revertedWith("Voting session havent started yet");
      })

      it("Should emit event: WorkflowStatusChange", async function () {
        const currentStatus = Number(await voting.workflowStatus())
        await expect(
          voting.endVotingSession()
        ).to.emit(voting, "WorkflowStatusChange").withArgs(currentStatus, currentStatus + 1);
      })
    })
  })

  describe("Only voters", function () {
    let voting: Voting;
    let owner: any;
    let voter1: any;

    beforeEach(async function () {
      const { voting: _voting, owner: _owner, voter1: _voter1 } = await loadFixture(deployVotingFixtureWith1Voter);
      voting = _voting;
      owner = _owner;
      voter1 = _voter1;

      await voting.startProposalsRegistering();
    })

    it("Get voter should revert if not allowed voter", async function () {
      await expect(
        voting.connect(owner).getVoter(voter1.address)
      ).to.be.revertedWith("You're not a voter");
    })

    it("Get proposal should revert if not allowed voter", async function () {
      await expect(
        voting.connect(owner).getOneProposal(0)
      ).to.be.revertedWith("You're not a voter");
    })

    it("Add proposal should revert if not allowed voter", async function () {
      await expect(
        voting.connect(owner).addProposal("Proposal 1")
      ).to.be.revertedWith("You're not a voter");
    })

    it("Set vote should revert if not allowed voter", async function () {
      await expect(
        voting.connect(owner).setVote(0)
      ).to.be.revertedWith("You're not a voter");
    })
  });

  describe("Only Owner", function () {
    it("Add voter should revert if not owner", async function () {
      const { voting, voter1 } = await loadFixture(deployVotingFixtureWith1Voter);

      await expect(
        voting.connect(voter1).addVoter(voter1.address)
      ).to.be.revertedWithCustomError(voting, "OwnableUnauthorizedAccount");
    });

    it("Start Proposals Registration should revert if not owner", async function () {
      const { voting, voter1 } = await loadFixture(deployVotingFixtureWith1Voter);

      await expect(
        voting.connect(voter1).startProposalsRegistering()
      ).to.be.revertedWithCustomError(voting, "OwnableUnauthorizedAccount");
    });

    it("End Proposals Registration should revert if not owner", async function () {
      const { voting, voter1 } = await loadFixture(deployVotingFixtureWith1Voter);

      await expect(
        voting.connect(voter1).endProposalsRegistering()
      ).to.be.revertedWithCustomError(voting, "OwnableUnauthorizedAccount");
    });

    it("Start Voting should revert if not owner", async function () {
      const { voting, voter1 } = await loadFixture(deployVotingFixtureWith1Voter);

      await expect(
        voting.connect(voter1).startVotingSession()
      ).to.be.revertedWithCustomError(voting, "OwnableUnauthorizedAccount");
    });

    it("End Voting should revert if not owner", async function () {
      const { voting, voter1 } = await loadFixture(deployVotingFixtureWith1Voter);

      await expect(
        voting.connect(voter1).endVotingSession()
      ).to.be.revertedWithCustomError(voting, "OwnableUnauthorizedAccount");
    });

    it("Tally Votes should revert if not owner", async function () {
      const { voting, voter1 } = await loadFixture(deployVotingFixtureWith1Voter);

      await expect(
        voting.connect(voter1).tallyVotes()
      ).to.be.revertedWithCustomError(voting, "OwnableUnauthorizedAccount");
    });
  });
});
