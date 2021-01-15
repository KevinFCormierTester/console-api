/** *****************************************************************************
 * Licensed Materials - Property of IBM
 * (c) Copyright IBM Corporation 2018, 2019. All Rights Reserved.
 *
 * Note to U.S. Government Users Restricted Rights:
 * Use, duplication or disclosure restricted by GSA ADP Schedule
 * Contract with IBM Corp.
 * Copyright (c) 2020 Red Hat, Inc.
 ****************************************************************************** */

import _ from 'lodash';
import { getLatest, responseHasError } from '../lib/utils';
import KubeModel from './kube';
import logger from '../lib/logger';

export const HIVE_DOMAIN = 'hive.openshift.io';
export const UNINSTALL_LABEL = `${HIVE_DOMAIN}/uninstall`;
export const INSTALL_LABEL = `${HIVE_DOMAIN}/install`;
export const CLUSTER_LABEL = `${HIVE_DOMAIN}/cluster-deployment-name`;
export const UNINSTALL_LABEL_SELECTOR = (cluster) => `labelSelector=${UNINSTALL_LABEL}%3Dtrue%2C${CLUSTER_LABEL}%3D${cluster}`;
export const INSTALL_LABEL_SELECTOR = (cluster) => `labelSelector=${INSTALL_LABEL}%3Dtrue%2C${CLUSTER_LABEL}%3D${cluster}`;
export const UNINSTALL_LABEL_SELECTOR_ALL = `labelSelector=${UNINSTALL_LABEL}%3Dtrue`;
export const INSTALL_LABEL_SELECTOR_ALL = `labelSelector=${INSTALL_LABEL}%3Dtrue`;

export const CLUSTER_DOMAIN = 'cluster.open-cluster-management.io';
export const CLUSTER_NAMESPACE_LABEL = `${CLUSTER_DOMAIN}/managedCluster`;

export const CSR_LABEL = 'open-cluster-management.io/cluster-name';
export const CSR_LABEL_SELECTOR = (cluster) => `labelSelector=${CSR_LABEL}%3D${cluster}`;
export const CSR_LABEL_SELECTOR_ALL = `labelSelector=${CSR_LABEL}`;

// The last char(s) in usage are units - need to be removed in order to get an int for calculation
function getPercentage(usage, capacity) {
  return (usage.substring(0, usage.length - 2) / capacity.substring(0, capacity.length - 2)) * 100;
}

function getCPUPercentage(usage, capacity) {
  return ((usage.substring(0, usage.length - 1) / 1000) / capacity) * 100;
}

function getClusterDeploymentStatus(clusterDeployment, uninstall, install) {
  const latestJobActive = (jobs) => (jobs && _.get(getLatest(jobs, 'metadata.creationTimestamp'), 'status.active', 0) > 0);
  const latestJobFailed = (jobs) => (jobs && _.get(getLatest(jobs, 'metadata.creationTimestamp'), 'status.failed', 0) > 0);

  let status = 'pending';
  if (latestJobActive(uninstall)) {
    status = 'destroying';
  } else if (latestJobActive(install)) {
    status = 'creating';
  } else if (latestJobFailed(install) || latestJobFailed(uninstall)) {
    status = 'provisionfailed';
  } else if (_.get(clusterDeployment, 'spec.installed')) {
    status = 'detached';
  }
  return status;
}

export function getStatus(cluster, csrs, clusterDeployment, uninstall, install) {
  const clusterDeploymentStatus = clusterDeployment
    ? getClusterDeploymentStatus(clusterDeployment, uninstall, install)
    : '';

  if (cluster) {
    let status;
    const clusterConditions = _.get(cluster, 'status.conditions') || [];
    const checkForCondition = (condition) => _.get(
      clusterConditions.find((c) => c.type === condition),
      'status',
    ) === 'True';
    const clusterAccepted = checkForCondition('HubAcceptedManagedCluster');
    const clusterJoined = checkForCondition('ManagedClusterJoined');
    const clusterAvailable = checkForCondition('ManagedClusterConditionAvailable');
    if (_.get(cluster, 'metadata.deletionTimestamp')) {
      status = 'detaching';
    } else if (!clusterAccepted) {
      status = 'notaccepted';
    } else if (!clusterJoined) {
      status = 'pendingimport';
      if (csrs && csrs.length) {
        status = !_.get(getLatest(csrs, 'metadata.creationTimestamp'), 'status.certificate')
          ? 'needsapproval' : 'pending';
      }
    } else {
      status = clusterAvailable ? 'ok' : 'offline';
    }

    // if ManagedCluster has not joined or is detaching, show ClusterDeployment status
    // as long as it is not 'detached' (which is the ready state when there is no attached ManagedCluster,
    // so this is the case is the cluster is being detached but not destroyed)
    if ((status === 'detaching' || !clusterJoined) && (clusterDeploymentStatus && clusterDeploymentStatus !== 'detached')) {
      return clusterDeploymentStatus;
    }
    return status;
  }
  return clusterDeploymentStatus;
}

function mapResources(resources, kind) {
  const resultMap = new Map();
  if (resources) {
    resources.forEach((r) => {
      if (r.metadata && (!r.kind || r.kind === kind)) {
        const key = r.metadata.name;
        resultMap.set(key, { metadata: r.metadata, raw: r });
      }
    });
  }
  return resultMap;
}

function mapResourceListByLabel(resourceList, label) {
  return new Map(Object.entries(_.groupBy(resourceList, (i) => i.metadata.labels[label])));
}

function mapData({
  managedClusters,
  managedClusterInfos,
  clusterDeployments,
  certificateSigningRequestList,
  uninstallJobList,
  installJobList,
}) {
  const managedClusterMap = mapResources(managedClusters, 'ManagedCluster');
  const clusterDeploymentMap = mapResources(clusterDeployments, 'ClusterDeployment');
  const managedClusterInfoMap = mapResources(managedClusterInfos, 'ManagedClusterInfo');
  const certificateSigningRequestListMap = mapResourceListByLabel(certificateSigningRequestList, CSR_LABEL);
  const uninstallJobListMap = mapResourceListByLabel(uninstallJobList, CLUSTER_LABEL);
  const installJobListMap = mapResourceListByLabel(installJobList, CLUSTER_LABEL);

  const uniqueClusterNames = new Set([
    ...managedClusterMap.keys(),
    ...clusterDeploymentMap.keys(),
  ]);

  return {
    managedClusterMap,
    clusterDeploymentMap,
    managedClusterInfoMap,
    certificateSigningRequestListMap,
    uninstallJobListMap,
    installJobListMap,
    uniqueClusterNames,
  };
}

function getClusterResourcesFromMappedData({
  managedClusterMap,
  clusterDeploymentMap,
  managedClusterInfoMap,
  certificateSigningRequestListMap,
  uninstallJobListMap,
  installJobListMap,
}, cluster) {
  const managedCluster = managedClusterMap.get(cluster);
  const managedClusterInfo = managedClusterInfoMap.get(cluster);
  const clusterDeployment = clusterDeploymentMap.get(cluster);
  const certificateSigningRequestList = certificateSigningRequestListMap.get(cluster);
  const uninstallJobList = uninstallJobListMap.get(cluster);
  const installJobList = installJobListMap.get(cluster);
  return {
    managedCluster,
    managedClusterInfo,
    clusterDeployment,
    certificateSigningRequestList,
    uninstallJobList,
    installJobList,
  };
}

function getBaseCluster(mappedData, cluster) {
  const { managedCluster, managedClusterInfo, clusterDeployment } = getClusterResourcesFromMappedData(mappedData, cluster);

  const metadata = _.get(managedCluster, 'metadata')
  || _.pick(_.get(managedClusterInfo || clusterDeployment, 'metadata'), ['name', 'namespace']);
  if (!metadata.namespace) {
    metadata.namespace = _.get(managedClusterInfo || clusterDeployment, 'metadata.namespace') || metadata.name;
  }
  if (!metadata.labels) {
    metadata.labels = _.get(managedClusterInfo, 'metadata.labels', '');
  }

  const clusterip = _.get(managedClusterInfo, 'raw.spec.masterEndpoint');

  const consoleURL = _.get(managedClusterInfo, 'raw.status.consoleURL') || _.get(clusterDeployment, 'raw.status.webConsoleURL');

  const apiURL = _.get(clusterDeployment, 'raw.status.apiURL');
  const masterEndpoint = _.get(managedClusterInfo, 'raw.spec.masterEndpoint');
  const serverAddress = apiURL || masterEndpoint;

  return {
    metadata,
    clusterip,
    consoleURL,
    rawCluster: _.get(managedCluster, 'raw'),
    rawStatus: _.get(managedClusterInfo, 'raw'),
    serverAddress,
  };
}

function findMatchedStatus(data) {
  const mappedData = mapData(data);
  const { uniqueClusterNames } = mappedData;
  const resultMap = new Map();

  uniqueClusterNames.forEach((c) => {
    const cluster = getBaseCluster(mappedData, c);
    const {
      managedCluster,
      managedClusterInfo,
      clusterDeployment,
      certificateSigningRequestList,
      uninstallJobList,
      installJobList,
    } = getClusterResourcesFromMappedData(mappedData, c);

    const nodeCount = (_.get(managedClusterInfo, 'raw.status.nodeList') || []).length;
    const nodes = nodeCount > 0 ? nodeCount : null;
    const k8sVersion = _.get(managedClusterInfo, 'raw.status.version', '-');
    const status = getStatus(
      _.get(managedCluster || managedClusterInfo, 'raw'),
      certificateSigningRequestList,
      _.get(clusterDeployment, 'raw'),
      uninstallJobList,
      installJobList,
    );
    _.merge(cluster, {
      nodes,
      status,
      k8sVersion,
      isHive: !!clusterDeployment,
      isManaged: !!managedCluster,
    });

    const OCP_DISTRIBUTION_INFO = 'raw.status.distributionInfo.ocp';
    if (managedClusterInfo && _.has(managedClusterInfo, OCP_DISTRIBUTION_INFO)) {
      const {
        availableUpdates: availableVersions,
        desiredVersion,
        upgradeFailed,
        version: distributionVersion,
      } = _.get(managedClusterInfo, OCP_DISTRIBUTION_INFO);
      _.merge(cluster, {
        availableVersions,
        desiredVersion,
        distributionVersion,
        upgradeFailed,
      });
    }
    resultMap.set(c, cluster);
  });
  return [...resultMap.values()];
}

function getClusterDeploymentSecrets(clusterDeployment) {
  return {
    adminKubeconfigSecret: _.get(clusterDeployment, 'spec.clusterMetadata.adminKubeconfigSecretRef.name', ''),
    adminPasswordSecret: _.get(clusterDeployment, 'spec.clusterMetadata.adminPasswordSecretRef.name', ''),
    installConfigSecret: _.get(clusterDeployment, 'spec.provisioning.installConfigSecretRef.name', ''),
  };
}

function findMatchedStatusForOverview(data) {
  const mappedData = mapData(data);
  const { uniqueClusterNames } = mappedData;
  const resultMap = new Map();

  uniqueClusterNames.forEach((c) => {
    const cluster = getBaseCluster(mappedData, c);
    const { managedCluster } = getClusterResourcesFromMappedData(mappedData, c);

    const status = getStatus(_.get(managedCluster, 'raw'));
    const capacity = _.get(managedCluster, 'raw.status.capacity');
    const allocatable = _.get(managedCluster, 'raw.status.allocatable');

    _.merge(cluster, {
      status,
      capacity,
      allocatable,
    });
    resultMap.set(c, cluster);
  });
  return [...resultMap.values()];
}

export default class ClusterModel extends KubeModel {
  constructor(args) {
    super(args);
    const { clusterNamespaces } = args;
    this.clusterNamespaces = clusterNamespaces;
  }

  async createClusterNamespace(clusterNamespace, checkForDeployment = false) {
    let projectResponse = await this.kubeConnector.post('/apis/project.openshift.io/v1/projectrequests', { metadata: { name: clusterNamespace } }).catch((err) => {
      logger.error(err);
      throw err;
    });

    if (responseHasError(projectResponse)) {
      if (projectResponse.code === 409) {
        projectResponse = await this.kubeConnector.get(`/apis/project.openshift.io/v1/projects/${clusterNamespace}`);
        // Check for terminating namespace
        if (_.get(projectResponse, 'status.phase') === 'Terminating') {
          throw new Error(`Namespace ${clusterNamespace} is terminating. Wait until it is terminated or use a different namespace.`);
        }
        const existingNamespaceClusters = await this.kubeConnector.get(`/apis/cluster.open-cluster-management.io/v1/managedclusters/${clusterNamespace}`);
        if (existingNamespaceClusters.items && existingNamespaceClusters.items.length > 0) {
          throw new Error(`A ManagedCluster of the name "${clusterNamespace}" already exists.`);
        }
        if (checkForDeployment) {
          const existingNamespaceClusterDeployments = await this.kubeConnector.get(`/apis/hive.openshift.io/v1/namespaces/${clusterNamespace}/clusterdeployments`);
          if (existingNamespaceClusterDeployments.items && existingNamespaceClusterDeployments.items.length > 0) {
            throw new Error(`Namespace "${clusterNamespace}" already contains a ClusterDeployment resource`);
          }
        }
      } else {
        return projectResponse;
      }
    }

    // Mark namespace as a cluster namespace
    // First try adding a label
    const labelNamespaceResponse = await this.kubeConnector.patch(
      `/api/v1/namespaces/${clusterNamespace}`,
      {
        headers: {
          'Content-Type': 'application/merge-patch+json',
        },
        body: {
          metadata: {
            labels: {
              [CLUSTER_NAMESPACE_LABEL]: clusterNamespace,
            },
          },
        },
      },
    ).catch((err) => {
      logger.error(err);
      throw err;
    });

    // If we created this namespace but could not label it, we have a problem
    if (projectResponse.code !== 409 && responseHasError(labelNamespaceResponse)) {
      return labelNamespaceResponse;
    }

    // Get updated project and update namespace cache as long as we were able to label it
    if (!responseHasError(labelNamespaceResponse)) {
      projectResponse = this.kubeConnector.get(`/apis/project.openshift.io/v1/projects/${clusterNamespace}`).catch((err) => {
        logger.error(err);
        throw err;
      });
      this.updateUserNamespaces(labelNamespaceResponse);
    }

    return projectResponse;
  }

  async createCluster(args) {
    let { cluster: resources } = args;
    const created = [];
    const updated = [];
    const errors = [];

    const checkAndCollectError = (response) => {
      if (response.code >= 400 || response.status === 'Failure' || response.message) {
        errors.push({ message: response.message });
        return true;
      }
      return false;
    };

    // get namespace and filter out any namespace resource
    let namespace;
    resources = resources.filter(({ kind, metadata = {}, spec = {} }) => {
      switch (kind) {
        case 'Namespace':
          namespace = metadata.name;
          return false;

        case 'ClusterDeployment':
          ({ namespace } = metadata);
          break;

        case 'ManagedCluster':
          ({ name: namespace } = metadata);
          break;

        default:
          if (spec && spec.clusterNamespace) {
            namespace = spec.clusterNamespace;
          }
          break;
      }
      return true;
    });

    // get resource end point for each resource
    const requestPaths = await Promise.all(resources.map(async (resource) => this.getResourceEndPoint(resource)));
    if (requestPaths.length > 0) {
      const missingTypes = [];
      const missingEndPoints = [];
      requestPaths.forEach((path, index) => {
        if (path === undefined) {
          missingTypes.push(`${resources[index].apiVersion}`);
        } else if (path === null) {
          missingEndPoints.push(`${resources[index].kind}`);
        }
      });
      if (missingTypes.length > 0) {
        errors.push({ message: `Cannot find resource types: ${missingTypes.join(', ')}` });
      }
      if (missingEndPoints.length > 0) {
        errors.push({ message: `Cannot find endpoints: ${missingEndPoints.join(', ')}` });
      }
      if (errors.length > 0) {
        return { errors };
      }
    } else {
      errors.push({ message: 'Cannot find any endpoints' });
      return { errors };
    }

    // try to create all resouces EXCEPT ClusterDeployment
    // we don't want to create ClusterDeployment until all the other resources successfully created
    // because we check if the ClusterDeployment exists in this namespace
    let clusterResource;
    let clusterRequestPath;
    resources = resources.filter((resource, index) => {
      if (resource.kind === 'ClusterDeployment') {
        clusterResource = resource;
        ([clusterRequestPath] = requestPaths.splice(index, 1));
        return false;
      }
      return true;
    });

    // if there's a namespace, try to create it
    if (!namespace) {
      errors.push({ message: 'No namespace specified' });
      return { errors };
    }
    let namespaceResponse;
    try {
      namespaceResponse = await this.createClusterNamespace(namespace, !!clusterResource);
    } catch (error) {
      errors.push({ message: error.message });
      return { errors };
    }
    if (checkAndCollectError(namespaceResponse)) {
      return { errors };
    }

    // try to create resources
    const result = await Promise.all(resources.map((resource, index) => this.kubeConnector.post(requestPaths[index], resource)
      .catch((err) => ({
        status: 'Failure',
        message: err.message,
      }))));
    const updates = [];
    result.filter((item, index) => {
      if (!responseHasError(item)) {
        const { kind, metadata = {} } = item;
        created.push({ name: metadata.name, kind });
        return false;
      } if (item.code === 409) {
        // filter out "already existing" errors
        updates.push({
          requestPath: requestPaths[index],
          resource: resources[index],
        });
        return false;
      }
      return true;
    }).forEach((item) => {
      checkAndCollectError(item);
    });

    // if the only errors were "already existing", patch those resources
    if (errors.length === 0 && updates.length > 0) {
      // Update the existing resources
      const replaced = await Promise.all(updates.map(({ requestPath, resource }) => {
        const name = _.get(resource, 'metadata.name');
        const path = `${requestPath}/${name}`;
        return this.kubeConnector.get(path)
          .then((existing) => {
            const resourceVersion = _.get(existing, 'metadata.resourceVersion');
            _.set(resource, 'metadata.resourceVersion', resourceVersion);
            const requestBody = {
              body: resource,
            };
            return this.kubeConnector.put(path, requestBody);
          }).catch((err) => {
            logger.error(err);
            throw err;
          });
      }));

      // report any errors
      replaced.forEach((item) => {
        if (!checkAndCollectError(item)) {
          const { kind, metadata = {} } = item;
          updated.push({ name: metadata.name, kind });
        }
      });
    }

    let importSecret;
    if (errors.length === 0) {
      if (clusterResource) {
        // last but not least, if everything else deployed, deploy ClusterDeployment
        // if that fails--user can press create again and not get a "Already Exists" message
        const deployment = await this.kubeConnector.post(clusterRequestPath, clusterResource)
          .catch((err) => ({
            status: 'Failure',
            message: err.message,
          }));
        checkAndCollectError(deployment);
      } else {
        // import case - fetch and return the generated secret
        importSecret = await this.pollImportYamlSecret(namespace, namespace);
        checkAndCollectError(importSecret);
      }
    }

    return {
      errors,
      updated,
      created,
      importSecret,
    };
  }

  async getClusterResources() {
    // Try cluster scope queries, falling back to per-cluster-namespace
    const rbacFallbackQuery = (clusterQuery, namespaceQueryFunction) => (
      this.kubeConnector.get(clusterQuery).then((allItems) => (allItems.items
        ? allItems.items
        : this.kubeConnector.getResources(
          namespaceQueryFunction,
          { namespaces: this.clusterNamespaces },
        ))).catch((err) => {
        logger.error(err);
        throw err;
      })
    );

    const [
      managedClusters,
      managedClusterInfos,
      clusterDeployments,
      certificateSigningRequestList,
      uninstallJobList,
      installJobList,
    ] = await Promise.all([
      rbacFallbackQuery(
        '/apis/cluster.open-cluster-management.io/v1/managedclusters',
        (ns) => `/apis/cluster.open-cluster-management.io/v1/managedclusters/${ns}`,
      ),
      rbacFallbackQuery(
        '/apis/internal.open-cluster-management.io/v1beta1/managedclusterinfos',
        (ns) => `/apis/internal.open-cluster-management.io/v1beta1/namespaces/${ns}/managedclusterinfos`,
      ),
      rbacFallbackQuery(
        '/apis/hive.openshift.io/v1/clusterdeployments',
        (ns) => `/apis/hive.openshift.io/v1/namespaces/${ns}/clusterdeployments`,
      ),
      this.kubeConnector.get(`/apis/certificates.k8s.io/v1beta1/certificatesigningrequests?${CSR_LABEL_SELECTOR_ALL}`)
        .then((allItems) => (allItems.items
          ? allItems.items
          : [])).catch((err) => {
          logger.error(err);
          throw err;
        }),
      rbacFallbackQuery(
        `/apis/batch/v1/jobs?${UNINSTALL_LABEL_SELECTOR_ALL}`,
        (ns) => `/apis/batch/v1/namespaces/${ns}/jobs?${UNINSTALL_LABEL_SELECTOR(ns)}`,
      ),
      rbacFallbackQuery(
        `/apis/batch/v1/jobs?${INSTALL_LABEL_SELECTOR_ALL}`,
        (ns) => `/apis/batch/v1/namespaces/${ns}/jobs?${INSTALL_LABEL_SELECTOR(ns)}`,
      ),
    ]);

    return {
      managedClusters,
      managedClusterInfos,
      clusterDeployments,
      certificateSigningRequestList,
      uninstallJobList,
      installJobList,
    };
  }

  async getNodeList(args = {}) {
    const { name } = args;
    const managedClusterInfo = await this.kubeConnector.get(
      `/apis/internal.open-cluster-management.io/v1beta1/namespaces/${name}/managedclusterinfos/${name}`,
    ).catch((err) => {
      logger.error(err);
      throw err;
    });
    return (_.get(managedClusterInfo, 'status.nodeList') || []).map((n) => ({ ...n, cluster: name }));
  }

  async getSingleCluster(args = {}) {
    const { name } = args;
    const listQuery = (query) => (
      this.kubeConnector.get(query).then((allItems) => (allItems.items ? allItems.items : [])).catch((err) => {
        logger.error(err);
        throw err;
      })
    );
    const [
      managedCluster,
      clusterDeployment,
      managedClusterInfo,
      certificateSigningRequestList,
      uninstallJobList,
      installJobList,
    ] = await Promise.all([
      this.kubeConnector.get(`/apis/cluster.open-cluster-management.io/v1/managedclusters/${name}`).catch((err) => {
        logger.error(err);
        throw err;
      }),
      this.kubeConnector.get(`/apis/hive.openshift.io/v1/namespaces/${name}/clusterdeployments/${name}`).catch((err) => {
        logger.error(err);
        throw err;
      }),
      this.kubeConnector.get(`/apis/internal.open-cluster-management.io/v1beta1/namespaces/${name}/managedclusterinfos/${name}`).catch((err) => {
        logger.error(err);
        throw err;
      }),
      listQuery(`/apis/certificates.k8s.io/v1beta1/certificatesigningrequests?${CSR_LABEL_SELECTOR(name)}`),
      listQuery(`/apis/batch/v1/namespaces/${name}/jobs?${UNINSTALL_LABEL_SELECTOR(name)}`),
      listQuery(`/apis/batch/v1/namespaces/${name}/jobs?${INSTALL_LABEL_SELECTOR(name)}`),
    ]);

    if ((responseHasError(managedCluster) || responseHasError(managedClusterInfo)) && responseHasError(clusterDeployment)) {
      return [];
    }

    const [result] = findMatchedStatus({
      managedClusters: [managedCluster],
      clusterDeployments: [clusterDeployment],
      managedClusterInfos: [managedClusterInfo],
      certificateSigningRequestList,
      uninstallJobList,
      installJobList,
    });
    const clusterDeploymentSecrets = getClusterDeploymentSecrets(clusterDeployment);

    return [{ ...result, ...clusterDeploymentSecrets }];
  }

  async getClusters(args = {}) {
    const resources = await this.getClusterResources();
    const results = findMatchedStatus(resources);
    if (args.name) {
      return results.filter((c) => c.metadata.name === args.name)[0];
    }
    return results;
  }

  async getAllClusters(args = {}) {
    const resources = await this.getClusterResources();
    const results = findMatchedStatusForOverview(resources);
    if (args.name) {
      return results.filter((c) => c.metadata.name === args.name)[0];
    }
    return results;
  }

  static resolveUsage(kind, clusterstatus) {
    const defaultUsage = kind === 'cpu' ? '0m' : '0Mi';
    const defaultCapacity = kind === 'cpu' ? '1' : '1Mi';
    const allocatable = _.get(clusterstatus, `spec.allocatable.${kind}`, defaultUsage);
    const capacity = _.get(clusterstatus, `spec.capacity.${kind}`, defaultCapacity);

    if (capacity === '0' || capacity === 0) {
      return '0';
    }

    if (kind === 'cpu') {
      return parseInt(getCPUPercentage(allocatable, capacity), 10);
    }

    return parseInt(getPercentage(allocatable, capacity), 10);
  }

  async detachCluster(args) {
    const { namespace, cluster, destroy = false } = args;
    const managedCluster = `/apis/cluster.open-cluster-management.io/v1/managedclusters/${cluster}`;
    const clusterDeployment = `/apis/hive.openshift.io/v1/namespaces/${namespace}/clusterdeployments/${cluster}`;
    const machinePools = `/apis/hive.openshift.io/v1/namespaces/${namespace}/machinepools`;

    const detachManagedClusterResponse = await this.kubeConnector.delete(managedCluster).catch((err) => {
      logger.error(err);
      throw err;
    });

    if (!destroy && responseHasError(detachManagedClusterResponse)) {
      return detachManagedClusterResponse;
    }

    if (destroy) {
      // Find MachinePools to delete
      const machinePoolsResponse = await this.kubeConnector.get(machinePools).catch((err) => {
        logger.error(err);
        throw err;
      });
      if (machinePoolsResponse.kind === 'Status') {
        return machinePoolsResponse;
      }
      const machinePoolsToDelete = (machinePoolsResponse.items
        && machinePoolsResponse.items
          .filter((item) => _.get(item, 'spec.clusterDeploymentRef.name') === cluster)
          .map((item) => `${machinePools}/${_.get(item, 'metadata.name')}`)) || [];

      // Create full list of resources to delete
      const resourcesToDelete = [
        clusterDeployment,
        ...machinePoolsToDelete,
      ];
      const destroyResponses = await Promise.all(resourcesToDelete.map((link) => this.kubeConnector.delete(link))).catch((err) => {
        logger.error(err);
        throw err;
      });
      // MachinePool deletion returns a Status with status==='Success'
      const failedResponse = destroyResponses.find((dr) => dr.kind === 'Status' && dr.status !== 'Success');
      if (failedResponse) {
        return failedResponse;
      }
    }

    return 204;
  }

  async getClusterImageSets() {
    const clusterImageSets = {};
    // global--no namespace
    const response = await this.kubeConnector.get('/apis/hive.openshift.io/v1/clusterimagesets').catch((err) => {
      logger.error(err);
      throw err;
    });
    response.items.forEach((imageSet) => {
      const name = _.get(imageSet, 'metadata.name');
      const releaseImage = _.get(imageSet, 'spec.releaseImage');
      if (name && releaseImage) {
        clusterImageSets[releaseImage] = {};
        clusterImageSets[releaseImage].releaseImage = releaseImage;
        clusterImageSets[releaseImage].name = name;
        clusterImageSets[releaseImage].channel = _.get(imageSet, 'metadata.labels.channel', '');
        clusterImageSets[releaseImage].visible = _.get(imageSet, 'metadata.labels.visible', '');
        clusterImageSets[releaseImage].platformAws = _.get(imageSet, 'metadata.labels["platform.aws"]', '');
        clusterImageSets[releaseImage].platformGcp = _.get(imageSet, 'metadata.labels["platform.gcp"]', '');
        clusterImageSets[releaseImage].platformAzure = _.get(imageSet, 'metadata.labels["platform.azure"]', '');
        clusterImageSets[releaseImage].platformBmc = _.get(imageSet, 'metadata.labels["platform.bmc"]', '');
        clusterImageSets[releaseImage].platformVmware = _.get(imageSet, 'metadata.labels["platform.vmware"]', '');
      }
    });
    return Object.entries(clusterImageSets).map(([, data]) => (data));
  }

  async pollImportYamlSecret(clusterNamespace, clusterName) {
    let count = 0;
    let importYamlSecret;

    const poll = async (resolve, reject) => {
      const secretUrl = `/api/v1/namespaces/${clusterNamespace}/secrets/${clusterName}-import`;
      importYamlSecret = await this.kubeConnector.get(secretUrl, {}, true).catch((err) => {
        logger.error(err);
        throw err;
      });

      if (importYamlSecret.code === 404 && count < 5) {
        count += 1;
        setTimeout(poll, 2000, resolve, reject);
      } else {
        resolve(importYamlSecret);
      }
    };

    return new Promise(poll);
  }

  async getClusterAddons(args = {}) {
    const { namespace } = args;
    const clusterManagementAddons = await this.kubeConnector.get('/apis/addon.open-cluster-management.io/v1alpha1/clustermanagementaddons')
      .catch((err) => {
        logger.error(err);
        throw err;
      });
    let managedClusterAddons = await this.kubeConnector.get(`/apis/addon.open-cluster-management.io/v1alpha1/namespaces/${namespace}/managedclusteraddons`)
      .catch((err) => {
        logger.error(err);
        throw err;
      });

    if (responseHasError(clusterManagementAddons) && clusterManagementAddons.code !== 403) {
      const { details, code, message } = clusterManagementAddons;
      throw new Error(`Error fetching ${details.kind}: ${code} - ${message}`);
    }
    if (responseHasError(managedClusterAddons)) {
      const { details, code, message } = managedClusterAddons;
      throw new Error(`Error fetching ${details.kind}: ${code} - ${message}`);
    }

    managedClusterAddons = managedClusterAddons.items.map((addon) => {
      const { metadata, status: { conditions = [], relatedObjects, addOnMeta } = {} } = addon;
      const crd = _.get(relatedObjects, '[0]', {});

      // Order of precedence:
      // degraded=true
      // progressing=true
      // available=true
      // all conditions are false = progressing
      // available=false = unavailable
      // default = unknown
      const isDegraded = conditions.find(({ type, status }) => type === 'Degraded' && status === 'True') || false;
      const isProgressing = conditions.find(({ type, status }) => type === 'Progressing' && status === 'True') || false;
      const isAvailable = conditions.find(({ type, status }) => type === 'Available' && status === 'True') || false;
      const allFalseCondition = conditions.every(({ status }) => status !== 'True') ? { type: 'Progressing' } : false;
      const isNotAvailable = conditions.find(({ type, status }) => type === 'Available' && status === 'False') || false;
      if (isNotAvailable) {
        isNotAvailable.type = 'Unavailable';
      }
      const status = isDegraded || isProgressing || isAvailable || allFalseCondition || isNotAvailable || { type: 'Unknown' };
      const description = _.get(addOnMeta, 'description', '');
      return { metadata, status, addOnResource: { ...crd, description } };
    });

    // Check for ClusterManagementAddons that are not configured for this cluster
    // If not enabled construct an object to send back to the UI
    if (clusterManagementAddons.items) {
      clusterManagementAddons.items.forEach((cma) => {
        const addOnConfigCRD = _.get(cma, 'spec.addOnConfiguration.crdName', '');
        const addOnName = _.get(cma, 'metadata.name', '');
        const hasAddon = !!managedClusterAddons.find(({ metadata }) => metadata.name === addOnName);
        if (!hasAddon) {
          const resource = addOnConfigCRD.slice(0, addOnConfigCRD.indexOf('.'));
          const group = addOnConfigCRD.slice(addOnConfigCRD.indexOf('.'));
          const addOnObj = {
            metadata: { name: cma.metadata.name, namespace },
            addOnResource: {
              name: '', group, resource, description: _.get(cma, 'spec.addOnMeta.description', ''),
            },
            status: { type: 'Disabled' },
          };
          managedClusterAddons.push(addOnObj);
        }
      });
    }

    return managedClusterAddons;
  }
}
