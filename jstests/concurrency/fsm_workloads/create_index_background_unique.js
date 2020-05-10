'use strict';

/**
 * create_index_background_unique.js
 *
 * Creates multiple unique background indexes in parallel.
 *
 * @tags: [creates_background_indexes]
 */

var $config = (function() {
    var data = {
        prefix: "create_index_background_unique_",
        numDocsToLoad: 5000,
        shouldBuild: true,  // used to ensure ordering of buildIndex/dropIndex calls
        iterationCount: 0,
        getCollectionNameForThread: function(threadId) {
            return this.prefix + threadId.toString();
        },
        // Allows tests that inherit from this one to specify options other than the default.
        getCollectionOptions: function() {
            return {};
        },
        buildvariableSizedDoc: function(uniquePrefix) {
            const indexedVal = uniquePrefix + Array(Random.randInt(1000)).toString();
            const doc = {x: indexedVal};
            return doc;
        },
    };

    let buildIndexHelper = function(db, collName, data) {
        data.shouldBuild = false;
        const res = db.runCommand({
            createIndexes: data.getCollectionNameForThread(data.tid),
            indexes: [{key: {x: 1}, name: "x_1", unique: true, background: true}]
        });
        assertAlways.commandWorked(res);
    };

    let dropIndexHelper = function(db, collName, data) {
        data.shouldBuild = true;
        // In the case that we have an even # of iterations, we skip the final drop so that
        // validation can be performed on the indexes created.
        if (data.iterationCount === data.iterations) {
            return;
        }

        assertAlways.commandWorked(
            db.runCommand({dropIndexes: data.getCollectionNameForThread(data.tid), index: "x_1"}));
    };

    var states = (function() {
        function buildIndex(db, collName) {
            this.iterationCount++;
            // Make sure successive calls to buildIndex do not occur without a dropIndex in between.
            // This is to ensure that workloads extending from this one can add additional states
            // and still maintain the base workload's guarantee that buildIndex and dropIndex are
            // called in succession.
            if (!this.shouldBuild) {
                dropIndexHelper(db, collName, this);
                return;
            }
            buildIndexHelper(db, collName, this);
        }

        function dropIndex(db, collName) {
            this.iterationCount++;
            // Make sure successive calls to dropIndex do not occur without a buildIndex in between.
            // This is to ensure that workloads extending from this one can add additional states
            // and still maintain the base workload's guarantee that buildIndex and dropIndex are
            // called in succession.
            if (this.shouldBuild) {
                buildIndexHelper(db, collName, this);
                return;
            }
            dropIndexHelper(db, collName, this);
        }

        return {
            buildIndex: buildIndex,
            dropIndex: dropIndex,
        };
    })();

    // Any changes to the relative probabilities of the states in `transitions` should keep in mind
    // how workloads extending this workload will behave.
    var transitions = {
        buildIndex: {dropIndex: 1.0},
        dropIndex: {buildIndex: 1.0},
    };

    function setup(db, collName, cluster) {
        for (let j = 0; j < this.threadCount; ++j) {
            const collectionName = this.getCollectionNameForThread(j);
            assertAlways.commandWorked(
                db.createCollection(collectionName, this.getCollectionOptions()));
            var bulk = db[collectionName].initializeUnorderedBulkOp();

            // Preload documents for each thread's collection. This ensures that the index build and
            // drop have meaningful work to do.
            for (let i = 0; i < this.numDocsToLoad; ++i) {
                const uniqueValuePrefix = i.toString() + "_";
                bulk.insert(this.buildvariableSizedDoc(uniqueValuePrefix));
            }
            assertAlways.writeOK(bulk.execute());
            assertAlways.eq(this.numDocsToLoad, db[collectionName].find({}).itcount());
        }
    }

    return {
        threadCount: 10,
        iterations: 11,
        data: data,
        states: states,
        startState: 'buildIndex',
        transitions: transitions,
        setup: setup,
    };
})();
