Ext.define("test-status-by-attribute", {
    extend: 'Rally.app.App',
    componentCls: 'app',
    logger: new Rally.technicalservices.Logger(),
    defaults: { margin: 10 },

    integrationHeaders : {
        name : "cats-test-status-by-attribute"
    },
    config: {
       defaultSettings: {
          modelName: 'TestCase',
          xAxisField: 'LastVerdict',
          yAxisField: 'TestSet: Name',
          xAxisValues: undefined,
          yAxisValues: undefined,
          includeXTotal: true,
          includeYTotal: true,
          gridFilter: '',
          includeBlanks: true,
          sortBy: 'total',
          sortDir: 'desc',
          rowLimit: ''
       }
    },

    yAxisOptions: [],

    launch: function() {
        var me = this;
        this._initializeApp();
    },
    onTimeboxScopeChange: function(timeboxScope){
        this.logger.log('onTimeboxScopeChange', timeboxScope);
        this.getContext().setTimeboxScope(timeboxScope);
        this._updateDisplay();
    },
    _initializeApp: function(){
        fieldBlackList = ['Milestones','Tags'];
        Deft.Promise.all([
            Rally.technicalservices.WsapiToolbox.fetchModelFields('TestSet',fieldBlackList),
            Rally.technicalservices.WsapiToolbox.fetchModelFields('Artifact',fieldBlackList),
            Rally.technicalservices.WsapiToolbox.fetchModelFields('TestCase',fieldBlackList),
            Rally.technicalservices.WsapiToolbox.fetchAllowedValues('TestCaseResult','Verdict')
        ]).then({
            success: function(results){
                this._initializeYAxisOptions(results[0],results[1], results[2]);
                this.possibleVerdicts = results[3];
                this._initializeDisplay();
            },
            failure: this._showErrorNotification,
            scope: this
        });
    },

    _initializeYAxisOptions: function(testSetFields, artifactFields, testCaseFields){
        var yAxisOptions = [];

        Ext.Array.each(testCaseFields, function(f){
            var defn = f.attributeDefinition;

            if ((defn && defn.Constrained && defn.AttributeType != "COLLECTION") ||
                f.name === 'TestFolder'){
              yAxisOptions.push({
                 displayName: 'TestCase: ' + f.displayName,
                 modelName: 'TestCase',
                 fieldName: f.name,
                 queryName: f.name
              })
            }
        });

        Ext.Array.each(testSetFields, function(f){
            var defn = f.attributeDefinition;
            if ((defn && defn.Constrained && defn.AttributeType != "COLLECTION" ) ||
                f.name === 'Name'){
              yAxisOptions.push({
                 displayName: 'TestSet: ' + f.displayName,
                 modelName: 'TestSet',
                 fieldName: f.name,
                 queryName: 'TestSets.' + f.name
              })
            }
        });

        Ext.Array.each(artifactFields, function(f){
            var defn = f.attributeDefinition;
            if ((defn && defn.Constrained && defn.AttributeType != "COLLECTION" ) ||
                f.name === 'Name'){
              yAxisOptions.push({
                 displayName: 'WorkProduct: ' + f.displayName,
                 modelName: 'WorkProduct',
                 fieldName: f.name,
                 queryName: 'WorkProduct.' + f.name
              })
            }
        });

        this.logger.log('yAxisOptions', yAxisOptions);
        this.yAxisOptions = yAxisOptions;

    },
    _showErrorNotification: function(msg){
        Rally.ui.notify.Notifier.showError({message: msg});
    },
    _initializeDisplay: function(){
        var selectorBox = this.add({
            xtype: 'container',
            layout: 'hbox',
            itemId: 'selectorBox'
        });

        selectorBox.add({
            xtype: 'rallycombobox',
            store: Ext.create('Ext.data.Store',{
                fields: ['displayName','modelName','fieldName'],
                data: this.yAxisOptions
            }),
            itemId: 'yAxisField',
            labelAlign: 'right',
            margin: 5,
            fieldLabel: 'Group by',
            labelWidth: 75,
            width: 300,
            displayField: 'displayName',
            valueField: 'displayName'
        });

        selectorBox.add({
            xtype: 'rallybutton',
            text: 'Update',
            margin: 5,
            listeners: {
                click: this._updateDisplay,
                scope: this
            }
        });

        this.add({
            xtype:'container',
            itemId:'display_box'
        });
    },
    _fetchTimeboxData: function(){
       this.logger.log('_fetchTimeboxData', this.getContext().getTimeboxScope());
       var deferred = Ext.create('Deft.Deferred');
        this.timeboxRecords = null;
       if (!this.getContext().getTimeboxScope()){
           deferred.resolve(null);
       } else {
           var timebox = this.getContext().getTimeboxScope();
            this.logger.log('timeboxScope', this.getContext().getTimeboxScope().getQueryFilter());
            Rally.technicalservices.WsapiToolbox.fetchArtifacts({
                 models: ['TestSet','HierarchicalRequirement','Defect'],
                 fetch: ['ObjectID','TestCaseCount','TestCases','LastVerdict'],
                 filters: this.getContext().getTimeboxScope().getQueryFilter()
               }).then({
                  success: function(results){
                     deferred.resolve(results);
                  },
                  failure: function(msg){
                      deferred.reject(msg);
                  }
               });
        }
       return deferred.promise;
    },
    _updateDisplay: function(){
        var me = this,
            y_selector = this.down('#yAxisField');

        if ( Ext.isEmpty(y_selector.getValue()) ) { return; }

        var yAxisModelName = this._getAxisModelName(y_selector),
            yAxisFieldName = this._getAxisFieldName(y_selector);

        this.setLoading();
        Deft.Chain.pipeline([
            function(){
               return me._fetchTimeboxData();
            },
            function(timeboxRecords) {
                return me._fetchData(yAxisModelName,yAxisFieldName, timeboxRecords);
            },
            function(results) {
                return me._organizeTestCaseResults(yAxisModelName,yAxisFieldName,results);
            },
            function(counts) {
                return me._buildGrid(counts);
            }],this).then({
            failure: this._showErrorNotification,
            success: null,
            scope: this
        }).always(function() { me.setLoading(false);});
    },

    _getAxisModelName: function(selector) {
        var value = selector.getValue();

        var record = selector.getStore().findRecord('displayName',value);
        return record && record.get('modelName');
    },

    _getAxisFieldName: function(selector) {
        var value = selector.getValue();
        var record = selector.getStore().findRecord('displayName',value);
        return record && record.get('fieldName');
    },

    _getFilters: function(yAxisModelName,yAxisFieldName, timeboxRecords){
        this.logger.log('_getFilters', yAxisModelName, yAxisFieldName, timeboxRecords);

        var filters = [];
        if (timeboxRecords){
            Ext.Array.each(timeboxRecords, function(r){
               if (r.get('TestCaseCount') > 0){
                 var type = 'TestCase.WorkProduct.ObjectID';
                 if (r.get('_type') === 'testset'){
                    type = 'TestSet.ObjectID';
                 }
                 filters.push({
                    property: type,
                    value: r.get('ObjectID')
                 });
               }
            });
            if (filters.length > 1){
                filters = Rally.data.wsapi.Filter.or(filters);
                this.logger.log('_getFilters', filters.toString());
            }
            if (filters.length === 0){
               //no records are in the timebox
               filters = [{
                   property: 'ObjectID',
                   value: 0
               }];
            }
        } else {  //No timebox so just get everything in scope
          if (yAxisModelName === 'Artifact'){
            filters.push({
               property: 'TestCase.WorkProduct.ObjectID',
               operator: '>',
               value: 0
            });
          } else if (yAxisModelName === 'TestSet'){
             //If timebox scoped, then add that
             filters.push({
                property: 'TestSet.ObjectID',
                operator: '>',
                value: 0
             });
          } else {
             filters = [{property:'ObjectID',operator:'>',value:0}]
          }
          this.logger.log('_getFilters', filters);
        }

       return filters;
    },

    _fetchData: function(yAxisModelName,yAxisFieldName, timeboxRecords){
        this.logger.log('_updateDisplay', yAxisModelName, yAxisFieldName);
         this.timeboxRecords = timeboxRecords;
        return Rally.technicalservices.WsapiToolbox.fetchWsapiRecords({
            model: 'TestCaseResult',
            fetch: ['TestCase','Verdict','TestSet','WorkProduct','ObjectID','Name','Date',yAxisFieldName],
            enablePostGet: true,
            filters: this._getFilters(yAxisModelName, yAxisFieldName, timeboxRecords),
            sorters: [{property:'Date',direction:'ASC'}]
        });
    },

    _organizeTestCaseResults: function(yAxisModelName,yAxisFieldName,results){
        this.logger.log('Organize Results', results.length);
        // assumes that the results have been returned in ascending order so we can just
        // replace with the latest and eventually get the last for each test case and workproduct/testset
        // first, create a hash of hashes to distill down to the most recent result for each combo
        var results_by_testcase_and_subset = {};
        Ext.Array.each(results, function(result){
            var testcase_oid = result.get('TestCase') && result.get('TestCase').ObjectID;
            var related_item_oid = result.get(yAxisModelName) && result.get(yAxisModelName).ObjectID || 'None';
            if ( yAxisModelName === "WorkProduct" ){
                related_item_oid = result.get('TestCase')[yAxisModelName] && result.get('TestCase')[yAxisModelName].ObjectID || 'None';
            }
            if ( Ext.isEmpty(results_by_testcase_and_subset[testcase_oid]) ) {
                results_by_testcase_and_subset[testcase_oid] = {};
            }
            results_by_testcase_and_subset[testcase_oid][related_item_oid] = result;
        });
        this.logger.log(results_by_testcase_and_subset);
        // second, create an array of results for each field value on the related item
        var results_by_fieldvalue = {};
        Ext.Object.each(results_by_testcase_and_subset,function(testcase_oid,related_item_results){
            Ext.Object.each(related_item_results, function(oid,result){
                value = this._getValueFromRelatedRecord(result,yAxisModelName,yAxisFieldName);
                verdict = result.get('Verdict');
                if ( Ext.isEmpty(results_by_fieldvalue[value]) ) {
                    results_by_fieldvalue[value] = { name: value };
                }
                if ( Ext.isEmpty(results_by_fieldvalue[value][verdict]) ) {
                    results_by_fieldvalue[value][verdict] = 0;
                }
                results_by_fieldvalue[value][verdict] = results_by_fieldvalue[value][verdict] + 1;
            },this);
        },this);

        return results_by_fieldvalue;
    },

    _getValueFromRelatedRecord: function(result,modelname,fieldname){
        var value = "";
        if ( modelname == "TestCase" || modelname == "TestSet" ) {
            value = result.get(modelname) && result.get(modelname)[fieldname] || "None";
        } else {
            value = result.get('TestCase')[modelname] && result.get('TestCase')[modelname][fieldname] || "None";
        }

        if ( value._refObjectName ) { value = value._refObjectName; }
        return value;
    },

    /*
     * Given a hash of counts (key is field value and value is hash of verdict counts)
     */
    _buildGrid: function(counts){
        this.logger.log('_buildGrid', counts);
        var x_values = this._getXValuesFromCounts(counts);
        var rows = Ext.Object.getValues(counts);

        this.logger.log('cols',x_values);
        this.logger.log('rows',rows);

        var store = Ext.create('Rally.data.custom.Store',{
            fields: x_values,
            data: rows,
            pageSize: rows.length
        });

        console.log(store);

        var container = this.down('#display_box');
        container.removeAll();
        container.add({
            xtype:'rallygrid',
            store: store,
            showRowActionsColumn: false,
            showPagingToolbar: false,
            columnCfgs: this._getColumns(x_values)
        });
    },

    _getColumns: function(x_values) {
        var columns = Ext.Array.map(x_values, function(value){
            if ( value == "name" ) {
                return { dataIndex:value, text: "", flex: 1 };
            }
            return { dataIndex:value, text:value, renderer: function(value){
                return value || 0;
            }};
        });
        return columns;
    },

    _getXValuesFromCounts: function(counts) {

        var names = [];
        Ext.Object.each(counts, function(field,count){
            Ext.Array.push(names,Ext.Object.getKeys(count));
        });
        names = names.concat(this.possibleVerdicts);
        return Ext.Array.unique(names);
    },

    getOptions: function() {
        return [
            {
                text: 'About...',
                handler: this._launchInfo,
                scope: this
            }
        ];
    },

    _launchInfo: function() {
        if ( this.about_dialog ) { this.about_dialog.destroy(); }
        this.about_dialog = Ext.create('Rally.technicalservices.InfoLink',{});
    },

    isExternal: function(){
        return typeof(this.getAppId()) == 'undefined';
    }

});
