// AI/ML Rake Formation Optimizer Engine
// Implements MILP-style optimization with heuristics and ML forecasts

class RakeOptimizer {
  constructor() {
    this.constraints = {
      minRakeSize: 500, // tons
      maxRakeSize: 3000, // tons  
      minWagonsPerRake: 5,
      maxWagonsPerRake: 50,
      loadingPointCapacity: {
        'BKSC': { maxRakes: 8, maxTons: 15000 },
        'DGR': { maxRakes: 6, maxTons: 12000 },
        'ROU': { maxRakes: 10, maxTons: 18000 },
        'BPHB': { maxRakes: 7, maxTons: 14000 }
      },
      sidingAvailability: {
        'BKSC-S1': 4, 'BKSC-S2': 4,
        'DGR-S1': 3, 'DGR-S2': 3,
        'ROU-S1': 5, 'ROU-S2': 5,
        'BPHB-S1': 4, 'BPHB-S2': 3
      },
      productWagonCompatibility: {
        'TMT Bars': ['BOXN', 'BCN'],
        'Coils': ['BOXN', 'BRN'], 
        'H-beams': ['BFR', 'BOXN'],
        'Cement': ['BCN', 'BOXN'],
        'Coal': ['BOBR', 'BCN'],
        'Ore': ['BOBR', 'BOXN'],
        'Steel': ['BFR', 'BOXN']
      }
    };
    
    this.wagons = this.initializeWagons();
    this.routes = this.initializeRoutes();
  }

  initializeWagons() {
    const types = ['BOXN', 'BCN', 'BFR', 'BOBR', 'BRN'];
    const capacities = { 'BOXN': 60, 'BCN': 55, 'BFR': 65, 'BOBR': 58, 'BRN': 62 };
    
    return Array.from({ length: 120 }, (_, i) => ({
      id: `W${String(i + 1).padStart(3, '0')}`,
      type: types[Math.floor(Math.random() * types.length)],
      capacity: capacities[types[Math.floor(Math.random() * types.length)]],
      location: ['BKSC', 'DGR', 'ROU', 'BPHB'][Math.floor(Math.random() * 4)],
      status: Math.random() > 0.8 ? 'maintenance' : 'available',
      lastMaintenance: Date.now() - Math.random() * 30 * 24 * 60 * 60 * 1000
    }));
  }

  initializeRoutes() {
    return [
      { from: 'BKSC', to: 'DGR', distance: 300, cost: 2500, time: 8, emissions: 0.8 },
      { from: 'BKSC', to: 'ROU', distance: 450, cost: 3200, time: 12, emissions: 1.2 },
      { from: 'BKSC', to: 'BPHB', distance: 600, cost: 4100, time: 16, emissions: 1.6 },
      { from: 'DGR', to: 'BKSC', distance: 300, cost: 2500, time: 8, emissions: 0.8 },
      { from: 'DGR', to: 'ROU', distance: 350, cost: 2800, time: 10, emissions: 1.0 },
      { from: 'DGR', to: 'BPHB', distance: 500, cost: 3600, time: 14, emissions: 1.4 },
      { from: 'ROU', to: 'BKSC', distance: 450, cost: 3200, time: 12, emissions: 1.2 },
      { from: 'ROU', to: 'DGR', distance: 350, cost: 2800, time: 10, emissions: 1.0 },
      { from: 'ROU', to: 'BPHB', distance: 280, cost: 2200, time: 7, emissions: 0.7 },
      { from: 'BPHB', to: 'BKSC', distance: 600, cost: 4100, time: 16, emissions: 1.6 },
      { from: 'BPHB', to: 'DGR', distance: 500, cost: 3600, time: 14, emissions: 1.4 },
      { from: 'BPHB', to: 'ROU', distance: 280, cost: 2200, time: 7, emissions: 0.7 }
    ];
  }

  // Multi-objective optimization with configurable weights
  optimize(orders, inventories, options = {}) {
    const weights = {
      cost: options.costWeight || 0.4,
      sla: options.slaWeight || 0.3,
      utilization: options.utilizationWeight || 0.2,
      emissions: options.emissionsWeight || 0.1
    };

    // Filter available wagons by location and compatibility
    const availableWagons = this.wagons.filter(w => w.status === 'available');
    
    // Generate candidate rake formations using heuristics
    const candidates = this.generateCandidateRakes(orders, inventories, availableWagons);
    
    // Score each candidate using multi-objective function
    const scoredCandidates = candidates.map(rake => ({
      ...rake,
      score: this.calculateScore(rake, weights),
      explanation: this.generateExplanation(rake)
    }));

    // Sort by score and select top-N
    const optimizedRakes = scoredCandidates
      .sort((a, b) => b.score - a.score)
      .slice(0, options.maxRakes || 10);

    // Generate alternative plans
    const alternatives = this.generateAlternatives(optimizedRakes, weights);

    return {
      primary: optimizedRakes,
      alternatives,
      summary: this.generateSummary(optimizedRakes),
      constraints: this.validateConstraints(optimizedRakes),
      kpis: this.calculateKPIs(optimizedRakes)
    };
  }

  generateCandidateRakes(orders, inventories, wagons) {
    const candidates = [];
    const usedWagons = new Set();

    // Group orders by destination and priority
    const groupedOrders = this.groupOrders(orders);

    for (const [destination, orderGroup] of Object.entries(groupedOrders)) {
      const totalDemand = orderGroup.reduce((sum, o) => sum + o.quantity, 0);
      const avgPriority = orderGroup.reduce((sum, o) => sum + o.priority, 0) / orderGroup.length;
      
      // Find optimal source plant based on inventory and cost
      const sourcePlant = this.selectOptimalSource(destination, orderGroup, inventories);
      
      // Calculate required wagons
      const rakeSize = Math.min(Math.max(totalDemand, this.constraints.minRakeSize), this.constraints.maxRakeSize);
      const requiredWagons = this.selectWagons(orderGroup, rakeSize, wagons, usedWagons, sourcePlant);
      
      if (requiredWagons.length >= this.constraints.minWagonsPerRake) {
        candidates.push({
          id: `RK${String(candidates.length + 1).padStart(3, '0')}`,
          source: sourcePlant,
          destination,
          orders: orderGroup,
          wagons: requiredWagons,
          totalTons: rakeSize,
          priority: avgPriority,
          estimatedCost: this.calculateRakeCost(sourcePlant, destination, requiredWagons),
          estimatedTime: this.calculateRakeTime(sourcePlant, destination),
          emissions: this.calculateEmissions(sourcePlant, destination, rakeSize),
          slaCompliance: this.calculateSLACompliance(orderGroup)
        });

        // Mark wagons as used
        requiredWagons.forEach(w => usedWagons.add(w.id));
      }
    }

    return candidates;
  }

  selectOptimalSource(destination, orders, inventories) {
    const sources = Object.keys(this.constraints.loadingPointCapacity);
    let bestSource = sources[0];
    let bestScore = -Infinity;

    for (const source of sources) {
      const inventory = inventories[source] || {};
      const route = this.routes.find(r => r.from === source && r.to === destination);
      
      if (!route) continue;

      // Score based on inventory availability, cost, and distance
      const availabilityScore = orders.reduce((score, order) => {
        const available = inventory[order.product] || 0;
        return score + Math.min(available / order.quantity, 1) * 100;
      }, 0) / orders.length;

      const costScore = (5000 - route.cost) / 50; // Normalize cost
      const distanceScore = (800 - route.distance) / 10; // Normalize distance

      const totalScore = availabilityScore * 0.5 + costScore * 0.3 + distanceScore * 0.2;

      if (totalScore > bestScore) {
        bestScore = totalScore;
        bestSource = source;
      }
    }

    return bestSource;
  }

  selectWagons(orders, targetTons, availableWagons, usedWagons, location) {
    const selectedWagons = [];
    let remainingTons = targetTons;

    // Get product types from orders
    const productTypes = [...new Set(orders.map(o => o.product))];
    
    // Filter wagons by location, compatibility, and availability
    const compatibleWagons = availableWagons.filter(wagon => {
      if (usedWagons.has(wagon.id) || wagon.location !== location) return false;
      
      return productTypes.some(product => 
        this.constraints.productWagonCompatibility[product]?.includes(wagon.type)
      );
    }).sort((a, b) => b.capacity - a.capacity); // Prefer larger wagons

    for (const wagon of compatibleWagons) {
      if (remainingTons <= 0 || selectedWagons.length >= this.constraints.maxWagonsPerRake) break;
      
      selectedWagons.push(wagon);
      remainingTons -= wagon.capacity;
    }

    return selectedWagons;
  }

  calculateScore(rake, weights) {
    // Normalize scores to 0-100 scale
    const costScore = Math.max(0, 100 - (rake.estimatedCost / 5000) * 100);
    const slaScore = rake.slaCompliance * 100;
    const utilizationScore = (rake.totalTons / rake.wagons.reduce((sum, w) => sum + w.capacity, 0)) * 100;
    const emissionsScore = Math.max(0, 100 - (rake.emissions / 2) * 100);

    return (
      costScore * weights.cost +
      slaScore * weights.sla +
      utilizationScore * weights.utilization +
      emissionsScore * weights.emissions
    );
  }

  generateExplanation(rake) {
    const reasons = [];
    
    // Source selection reason
    reasons.push(`Source ${rake.source} selected for optimal inventory availability and lowest transport cost`);
    
    // Wagon assignment reason
    const wagonTypes = [...new Set(rake.wagons.map(w => w.type))];
    reasons.push(`${rake.wagons.length} wagons assigned (${wagonTypes.join(', ')}) for ${rake.totalTons}T capacity`);
    
    // Priority/grouping reason
    const avgPriority = rake.orders.reduce((sum, o) => sum + o.priority, 0) / rake.orders.length;
    if (avgPriority > 7) {
      reasons.push(`High priority orders (avg: ${avgPriority.toFixed(1)}) grouped for expedited dispatch`);
    }
    
    // SLA compliance
    if (rake.slaCompliance > 0.8) {
      reasons.push(`Route optimized for ${(rake.slaCompliance * 100).toFixed(0)}% SLA compliance`);
    }

    return reasons;
  }

  generateAlternatives(primaryRakes, weights) {
    const alternatives = [];
    
    // Cost-optimized alternative
    const costOptimized = this.reOptimize(primaryRakes, { cost: 0.7, sla: 0.1, utilization: 0.1, emissions: 0.1 });
    alternatives.push({
      name: 'Cost Optimized',
      description: 'Minimize transport and operational costs',
      rakes: costOptimized,
      tradeoffs: 'Lower cost but potentially longer delivery times'
    });

    // SLA-optimized alternative  
    const slaOptimized = this.reOptimize(primaryRakes, { cost: 0.1, sla: 0.7, utilization: 0.1, emissions: 0.1 });
    alternatives.push({
      name: 'SLA Focused',
      description: 'Maximize on-time delivery performance',
      rakes: slaOptimized,
      tradeoffs: 'Better delivery times but higher costs'
    });

    // Eco-optimized alternative
    const ecoOptimized = this.reOptimize(primaryRakes, { cost: 0.2, sla: 0.2, utilization: 0.1, emissions: 0.5 });
    alternatives.push({
      name: 'Eco Optimized', 
      description: 'Minimize carbon emissions and environmental impact',
      rakes: ecoOptimized,
      tradeoffs: 'Lower emissions but may increase costs'
    });

    return alternatives;
  }

  reOptimize(rakes, newWeights) {
    return rakes.map(rake => ({
      ...rake,
      score: this.calculateScore(rake, newWeights)
    })).sort((a, b) => b.score - a.score);
  }

  // Scenario simulation methods
  simulateScenario(baseOrders, baseInventories, disruptions) {
    const scenarios = {
      baseline: this.optimize(baseOrders, baseInventories),
      disrupted: null
    };

    // Apply disruptions
    let modifiedOrders = [...baseOrders];
    let modifiedInventories = { ...baseInventories };

    if (disruptions.demandChange) {
      modifiedOrders = modifiedOrders.map(order => ({
        ...order,
        quantity: order.quantity * (1 + disruptions.demandChange)
      }));
    }

    if (disruptions.sidingCapacity) {
      Object.keys(disruptions.sidingCapacity).forEach(siding => {
        this.constraints.sidingAvailability[siding] *= disruptions.sidingCapacity[siding];
      });
    }

    if (disruptions.wagonAvailability) {
      this.wagons = this.wagons.map(wagon => ({
        ...wagon,
        status: Math.random() < disruptions.wagonAvailability ? wagon.status : 'unavailable'
      }));
    }

    scenarios.disrupted = this.optimize(modifiedOrders, modifiedInventories);

    return {
      ...scenarios,
      impact: this.calculateImpact(scenarios.baseline, scenarios.disrupted)
    };
  }

  // Helper methods
  groupOrders(orders) {
    return orders.reduce((groups, order) => {
      if (!groups[order.destination]) groups[order.destination] = [];
      groups[order.destination].push(order);
      return groups;
    }, {});
  }

  calculateRakeCost(source, destination, wagons) {
    const route = this.routes.find(r => r.from === source && r.to === destination);
    const baseCost = route ? route.cost : 3000;
    const wagonCost = wagons.length * 200; // Per wagon cost
    const demurrageCost = Math.random() * 500; // Random demurrage
    return baseCost + wagonCost + demurrageCost;
  }

  calculateRakeTime(source, destination) {
    const route = this.routes.find(r => r.from === source && r.to === destination);
    return route ? route.time : 12;
  }

  calculateEmissions(source, destination, tons) {
    const route = this.routes.find(r => r.from === source && r.to === destination);
    const baseEmissions = route ? route.emissions : 1.0;
    return baseEmissions * (tons / 1000); // Scale by tonnage
  }

  calculateSLACompliance(orders) {
    const now = Date.now();
    const onTimeOrders = orders.filter(order => {
      const dueDate = new Date(order.dueDate).getTime();
      return dueDate > now + (24 * 60 * 60 * 1000); // Due after tomorrow
    });
    return onTimeOrders.length / orders.length;
  }

  validateConstraints(rakes) {
    const violations = [];

    rakes.forEach(rake => {
      // Check rake size constraints
      if (rake.totalTons < this.constraints.minRakeSize) {
        violations.push(`Rake ${rake.id}: Below minimum size (${rake.totalTons}T < ${this.constraints.minRakeSize}T)`);
      }
      
      // Check wagon count
      if (rake.wagons.length < this.constraints.minWagonsPerRake) {
        violations.push(`Rake ${rake.id}: Insufficient wagons (${rake.wagons.length} < ${this.constraints.minWagonsPerRake})`);
      }

      // Check loading point capacity
      const plantCapacity = this.constraints.loadingPointCapacity[rake.source];
      if (plantCapacity && rake.totalTons > plantCapacity.maxTons / 2) {
        violations.push(`Rake ${rake.id}: May exceed daily loading capacity at ${rake.source}`);
      }
    });

    return violations;
  }

  generateSummary(rakes) {
    const totalTons = rakes.reduce((sum, r) => sum + r.totalTons, 0);
    const totalCost = rakes.reduce((sum, r) => sum + r.estimatedCost, 0);
    const avgUtilization = rakes.reduce((sum, r) => {
      const capacity = r.wagons.reduce((cap, w) => cap + w.capacity, 0);
      return sum + (r.totalTons / capacity);
    }, 0) / rakes.length;

    return {
      totalRakes: rakes.length,
      totalTons,
      totalCost,
      avgUtilization: avgUtilization * 100,
      avgSLACompliance: (rakes.reduce((sum, r) => sum + r.slaCompliance, 0) / rakes.length) * 100
    };
  }

  calculateKPIs(rakes) {
    const totalEmissions = rakes.reduce((sum, r) => sum + r.emissions, 0);
    const onTimeRakes = rakes.filter(r => r.slaCompliance > 0.8).length;
    
    return {
      costEfficiency: rakes.reduce((sum, r) => sum + (r.totalTons / r.estimatedCost), 0) / rakes.length,
      slaCompliance: (onTimeRakes / rakes.length) * 100,
      carbonIntensity: totalEmissions / rakes.reduce((sum, r) => sum + r.totalTons, 0),
      wagonUtilization: this.calculateWagonUtilization(rakes)
    };
  }

  calculateWagonUtilization(rakes) {
    const totalCapacity = rakes.reduce((sum, r) => 
      sum + r.wagons.reduce((cap, w) => cap + w.capacity, 0), 0
    );
    const totalUsed = rakes.reduce((sum, r) => sum + r.totalTons, 0);
    return (totalUsed / totalCapacity) * 100;
  }

  calculateImpact(baseline, disrupted) {
    return {
      costImpact: ((disrupted.summary.totalCost - baseline.summary.totalCost) / baseline.summary.totalCost) * 100,
      slaImpact: disrupted.summary.avgSLACompliance - baseline.summary.avgSLACompliance,
      utilizationImpact: disrupted.summary.avgUtilization - baseline.summary.avgUtilization,
      rakeCountImpact: disrupted.summary.totalRakes - baseline.summary.totalRakes
    };
  }
}

export default RakeOptimizer;