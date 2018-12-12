/** *****************************************************************************
 * Licensed Materials - Property of IBM
 * (c) Copyright IBM Corporation 2018. All Rights Reserved.
 *
 * Note to U.S. Government Users Restricted Rights:
 * Use, duplication or disclosure restricted by GSA ADP Schedule
 * Contract with IBM Corp.
 ****************************************************************************** */

export const typeDef = `
type Overview {
  clusters: [ClusterOverview]
  services: [ServiceOverview]
  applications: [ApplicationOverview]
  pods: [PodOverview]
}

type ClusterOverview implements K8sObject {
  metadata: Metadata
  capacity: ClusterCapacity
  usage: ClusterUsage
  status: String
}

type ClusterCapacity {
  cpu: String
  memory: String
  nodes: Int
  storage: String
}

type ClusterUsage {
  cpu: String
  memory: String
  pods: Int
  storage: String
}

type ServiceOverview {
  cluster: String
  labels: [Label]
  name: String
  namespace: String
  type: String
  uid: String
}

type ApplicationOverview implements K8sObject {
  metadata: Metadata
  raw: JSON
  selector: JSON
}

type PodOverview implements K8sObject {
  metadata: Metadata
  cluster: Cluster
  hostIP: String
  podIP: String
  restarts: Int
  startedAt: String
  status: String
}
`;

export const resolver = {
  Query: {
    overview: async (root, args, {
      clusterModel, applicationModel, resourceViewModel,
    }) => {
      const clusters = await clusterModel.getAllClusters();

      // number and what clusters
      const applications = await applicationModel.getApplications();

      // number, what cluster and status
      const pods = await resourceViewModel.fetchResources({ type: 'pods' });
      return {
        clusters, services: [], applications, pods,
      };
    },
  },
};
