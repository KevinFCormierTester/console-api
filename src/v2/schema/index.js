/** *****************************************************************************
 * Licensed Materials - Property of IBM
 * (c) Copyright IBM Corporation 2018. All Rights Reserved.
 *
 * Note to U.S. Government Users Restricted Rights:
 * Use, duplication or disclosure restricted by GSA ADP Schedule
 * Contract with IBM Corp.
 ****************************************************************************** */

import _ from 'lodash';
import { makeExecutableSchema } from 'graphql-tools';

import * as applications from './application';
import * as charts from './helmchart';
import * as cluster from './cluster';
import * as compliance from './compliance';
import * as filter from './filter';
import * as dashboard from './dashboard';
import * as json from './json';
import * as namespace from './namespace';
import * as node from './node';
import * as pod from './pod';
import * as policy from './policy';
import * as pvs from './pvs';
import * as genericResources from './generic-resources';
import * as query from './query';
import * as releases from './helmrels';
import * as repo from './helmrepo';
import * as search from './search';
import * as topology from './topology';
import * as userQuery from './user-query';

const modules = [
  applications,
  charts,
  cluster,
  compliance,
  filter,
  dashboard,
  json,
  namespace,
  node,
  pod,
  policy,
  pvs,
  query,
  genericResources,
  releases,
  repo,
  search,
  topology,
  userQuery,
];

const mainDefs = [`
schema {
  query: Query,
  mutation: Mutation,
}
`];

export const typeDefs = mainDefs.concat(modules.map(m => m.typeDef));
export const resolvers = _.merge(...modules.map(m => m.resolver));

const schema = makeExecutableSchema({ typeDefs, resolvers });

export default schema;
