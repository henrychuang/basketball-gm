/**
 * @name util.bbgmView
 * @namespace Framework for loading, displaying, and updating content. bbgmView is designed so that it is easy to write UIs that are granular in both reading from the database and updating the DOM, to minimize useless updates to previously cached or displayed values. See the documentation for util.bbgmView.init for more detail on use.
 */
define(["globals", "ui", "lib/jquery", "lib/knockout", "lib/knockout.mapping", "lib/underscore", "util/helpers", "util/viewHelpers"], function (g, ui, $, ko, komapping, _, helpers, viewHelpers) {
    "use strict";

    var vm;

    function display(args, updateEvents) {
        var leagueContentEl;

        leagueContentEl = document.getElementById("league_content");
        if (leagueContentEl.dataset.idLoaded !== args.id) {
//console.log('draw from scratch')
            ui.update({
                container: "league_content",
                template: args.id
            });
            ko.applyBindings(vm, leagueContentEl);
            if (args.uiFirst !== undefined) {
                args.uiFirst(vm);
            }
        }
        if (args.uiEvery !== undefined) {
            args.uiEvery(updateEvents, vm);
        }
    }

    function update(args) {
        return function (inputs, updateEvents, cb) {
            var afterEverything, i, leagueContentEl;

            // Reset league content and view model only if it's:
            // (1) if it's not loaded and not loading yet
            // (2) loaded, but loading something else
            leagueContentEl = document.getElementById("league_content");
            if ((leagueContentEl.dataset.idLoaded !== args.id && leagueContentEl.dataset.idLoading !== args.id) || (leagueContentEl.dataset.idLoaded === args.id && leagueContentEl.dataset.idLoading !== args.id && leagueContentEl.dataset.idLoading !== "")) {
                ko.cleanNode(leagueContentEl);

                leagueContentEl.dataset.idLoading = args.id;

                updateEvents.push("firstRun");

                // View model
                vm = new args.InitViewModel(inputs);
            } else if (leagueContentEl.dataset.idLoading === args.id) {
                // If this view is already loading, no need to update (in fact, updating can cause errors because the firstRun updateEvent is not set and thus some first-run-defined view model properties might be accessed).
                cb();
                return;
            }

            // This will be called after every runBefore and runWhenever function is finished.
            afterEverything = _.after(args.runWhenever.length + 1, function () {
                leagueContentEl.dataset.idLoading = ""; // Done loading
                cb();
            });

            $.when.apply(null, _.map(args.runBefore, function (fn) { return fn(inputs, updateEvents, vm); })).done(function () {
                var vars;

                if (arguments.length > 1) {
                    vars = $.extend.apply(null, arguments);
                } else {
                    vars = arguments[0];
                }

                if (vars !== undefined) {
                    // Check for errors/redirects
                    if (vars.errorMessage !== undefined) {
                        return helpers.error(vars.errorMessage, cb);
                    }
                    if (vars.redirectUrl !== undefined) {
                        return ui.realtimeUpdate([], vars.redirectUrl);
                    }

                    komapping.fromJS(vars, args.mapping, vm);
                }
//console.log(vars);
//console.log(vm);

                display(args, updateEvents);

                afterEverything();
            });

            for (i = 0; i < args.runWhenever.length; i++) {
                $.when(args.runWhenever[i](inputs, updateEvents, vm)).done(function (vars) {
                    if (vars !== undefined) {
                        komapping.fromJS(vars, args.mapping, vm);
                    }

                    afterEverything();
                });
            }
        };
    }

    function get(fnGet, fnUpdate) {
        return function (req) {
            viewHelpers.beforeLeague(req, function (updateEvents, cb) {
                var inputs;

                inputs = fnGet(req);
                if (inputs === undefined) {
                    inputs = {};
                }

                // Check for errors/redirects
                if (inputs.errorMessage !== undefined) {
                    return helpers.error(inputs.errorMessage, cb);
                }
                if (inputs.redirectUrl !== undefined) {
                    return ui.realtimeUpdate([], inputs.redirectUrl);
                }

                fnUpdate(inputs, updateEvents, cb);
            });
        };
    }

    function post(fnPost) {
        return function (req) {
            viewHelpers.beforeLeague(req, function () {
                fnPost(req);
            });
        };
    }

    /**
     * Initialize a view module.
     *
     * The output of this function should be returned by each view module to expose the public properties get (respond to GET requests) post (respond to POST requests) and update (typically just called by get, but it's convenient for testing to expose this too).
     *
     * The general flow of a GET request is: call args.get to parse input, use args.InitViewModel to initialize Knockout view model, run functions in args.runBefore to generate the required data (everything on a new page load, or only updated data on an update), run the Knockout mapping plugin on the results with args.mapping, display the template if it's not already loaded (i.e. first run only, not updates), call args.uiFirst if this is a new page load to do some one-time DOM manipulation, call args.uiEvery every page load for DOM manipulation, and map the results of the args.runWhenever functions to the view model whenever they are available (before or after display of template).
     *
     * @memberOf util.bbgmView
     * @param {Object} args Arguments, as described below.
     * @param {string} args.id Contains the unique id/name of the view. This should also be the name of the JavaScript file in ./js/views, as well as the name of the template file in ./templates.
     * @param {function(Object): Object=} args.get Function which takes a Davis.js request object, validates any inputs, and returns them in a usable object like {season: 2014, abbrev: "CHI"}. This function is called by Davis.js when a page is originally loaded (i.e. in response to a clicked link) or when some data is updated and ui.realtimeUpdate is called. So the same entry point is used for generating all the HTML from scratch and just updating it.
     * To display a full-screen error message, include an "errorMessage" property with string contents in the return object. To redirect to another URL, include a "redirectUrl" property containing the URL in the return object. Either displaying an error message or redirecting this way will short-circuit the rest of the loading of the view.
     * @param {function(Object)=} args.post Optional function which takes a Davis.js request object, validates any inputs, takes appropriate action to update the database if necessary, and ends by making a GET request for whatever page should be shown to the user. This GET request can contain some data (like an error/success message) to be displayed.
     * To display a full-screen error message, call helpers.error directly. To redirect to another URL, call ui.realtimeUpdate directly. No fancy short circuiting is needed like in args.get because nothing is run after args.post completes anyway.
     * @param {function(Object)=} args.InitViewModel Optional constructor function defining the initial Knockout view model structure created immediately after a GET request. This should only be used when absolutely necessary, and in those cases should be as minimal as possible. The only valid uses are (1) to create properties on the view model that are needed by other functions (in args.runBefore and args.runWhenever) to check if updates are needed, and (2) to define computed observables and the observables they directly depend on. As this is a constructor function, view model properites should be attached to this.
     * @param {Object=} args.mapping Optional object defining the structure of the mapping (via the Knockout mappping plugin) between the output of all args.runBefore and runWhenever functions. "All" means that this single mapping object is used in multiple different places with multiple different subsets of data, so it should be able to handle everything. Specifically, all the results of the args.runBefore functions are run through the mapping plugin together, while each result from a runWhenever function is run through separately. If undefined, then the default for the Knockout mappping plugin will be used.
     * @param {Array.<function(Object, Array.<string>, Object): Object=>} args.runBefore Array of functions run before the template is displayed/updated. Arguments of each function are inputs (return value of get), updateEvents (containing information about what changed this load/update, such as "gameSim" or "playerMovement", and also "firstRun" if this is the first load of a page and not a refresh), and vm (the current Knockout view model). If there is something to update, the function returns a jQuery promise that resolves when the updated data has been retrieved.
     * There are two ways that a args.runBefore function can update the view model: (1) send some data when it resolves, which is then applied (with the Knockout mapping plugin and args.mapping) after all args.runBefore functions have finished, or (2) update the view model directly. (1) is preferred to (2) unless there is some very compelling reason otherwise, because (1) means that all fast updates will happen together rather than having some parts of the UI update at different times. Normally, the view model should just be used to read values, and even then it should be done as minimally as possible.
    * To display a full-screen error message, include an "errorMessage" property with string contents in the object passed to the resolved promise. To redirect to another URL, include a "redirectUrl" property containing the URL in the object passed to the resolved promise. Either displaying an error message or redirecting this way will short-circuit the rest of the loading of the view (but only after all runBefore functions are complete).
     * @param {Array.<function(Object, Array.<string>, Object): Object=>=} args.runWhenever Similar to args.runBefore, except the template can be displayed before it finishes. Therefore, this is optional and should only be used for slow functions, which should be uncommon. The only other difference from args.runBefore is that the view model is updated after each one of these functions finishes, rather than waiting for all of them. Thus, it's somewhat less bad to update the view model directly here.
     * @param {function(Object)=} args.uiFirst Optional function run immediately after the template is displayed, and then never again regardless of how the page is updated. The argument is the current view model, which contains the results of args.runBefore. This function mainly exists for doing things like one-time DOM manipulation or setting up events. No asynchronous work or view model writing should be done here without a very good reason.
     * @param {function(Array.<string>, Object)=} args.uiEvery Optional function run immediately after args.uiFirst, and then again every time the UI is updated right after args.runBefore. The arguments are updateEvents (containing information about what changed this load/update, such as "gameSim" or "playerMovement", and also "firstRun" if this is the first load of a page and not a refresh) and the current view model, which contains the results of args.runBefore. This function mainly exists for doing repeated DOM manipulation (such as setting a dynamic title for the page, or updating dropdown menus from views.components.dropdown). No asynchronous work or view model writing should be done here without a very good reason.
     * @return {Object} Object with module's exposed properties: get, post, and update.
     */
    function init(args) {
        var output;

        args.InitViewModel = args.InitViewModel !== undefined ? args.InitViewModel : function () { };
        args.get = args.get !== undefined ? args.get : function () { return {}; };
        args.runWhenever = args.runWhenever !== undefined ? args.runWhenever : [];
        args.mapping = args.mapping !== undefined ? args.mapping : {};

        output = {};
        output.update = update(args);
        output.get = get(args.get, output.update);
        if (args.post !== undefined) {
            output.post = post(args.post);
        }

        return output;
    }

    return {
        init: init
    };
});