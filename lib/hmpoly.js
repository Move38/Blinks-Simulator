!function(e){if("object"==typeof exports&&"undefined"!=typeof module)module.exports=e();else if("function"==typeof define&&define.amd)define([],e);else{var f;"undefined"!=typeof window?f=window:"undefined"!=typeof global?f=global:"undefined"!=typeof self&&(f=self),f.hmpoly=e()}}(function(){var define,module,exports;return (function e(t,n,r){function s(o,u){if(!n[o]){if(!t[o]){var a=typeof require=="function"&&require;if(!u&&a)return a(o,!0);if(i)return i(o,!0);throw new Error("Cannot find module '"+o+"'")}var f=n[o]={exports:{}};t[o][0].call(f.exports,function(e){var n=t[o][1][e];return s(n?n:e)},f,f.exports,e,t,n,r)}return n[o].exports}var i=typeof require=="function"&&require;for(var o=0;o<r.length;o++)s(r[o]);return s})({1:[function(_dereq_,module,exports){
module.exports = {
    createPaddingPolygon: createPaddingPolygon
};

// Based on Hans Muller's Polygon margin & padding method
// http://hansmuller-webkit.blogspot.com/2013/04/growing-and-shrinking-polygons-round-one.html

function createOffsetEdge(edge, dx, dy)
{
    return {
        vertex1: {x: edge.vertex1.x + dx, y: edge.vertex1.y + dy},
        vertex2: {x: edge.vertex2.x + dx, y: edge.vertex2.y + dy}
    };
}
// based on http://local.wasp.uwa.edu.au/~pbourke/geometry/lineline2d/, edgeA => "line a", edgeB => "line b"
function edgesIntersection(edgeA, edgeB)
{
    var den = (edgeB.vertex2.y - edgeB.vertex1.y) * (edgeA.vertex2.x - edgeA.vertex1.x) - (edgeB.vertex2.x - edgeB.vertex1.x) * (edgeA.vertex2.y - edgeA.vertex1.y);
    if (den == 0)
        return null;  // lines are parallel or conincident

    var ua = ((edgeB.vertex2.x - edgeB.vertex1.x) * (edgeA.vertex1.y - edgeB.vertex1.y) - (edgeB.vertex2.y - edgeB.vertex1.y) * (edgeA.vertex1.x - edgeB.vertex1.x)) / den;
    var ub = ((edgeA.vertex2.x - edgeA.vertex1.x) * (edgeA.vertex1.y - edgeB.vertex1.y) - (edgeA.vertex2.y - edgeA.vertex1.y) * (edgeA.vertex1.x - edgeB.vertex1.x)) / den;

    if (ua < 0 || ub < 0 || ua > 1 || ub > 1)
        return null;
    return {x: edgeA.vertex1.x + ua * (edgeA.vertex2.x - edgeA.vertex1.x),  y: edgeA.vertex1.y + ua * (edgeA.vertex2.y - edgeA.vertex1.y)};
}
function appendArc(vertices, center, radius, startVertex, endVertex, isPaddingBoundary)
{
    const twoPI = Math.PI * 2;
    var startAngle = Math.atan2(startVertex.y - center.y, startVertex.x - center.x);
    var endAngle = Math.atan2(endVertex.y - center.y, endVertex.x - center.x);
    if (startAngle < 0)
        startAngle += twoPI;
    if (endAngle < 0)
        endAngle += twoPI;
    var arcSegmentCount = 5; // An odd number so that one arc vertex will be eactly arcRadius from center.
    var angle = ((startAngle > endAngle) ? (startAngle - endAngle) : (startAngle + twoPI - endAngle));
    var angle5 =  ((isPaddingBoundary) ? -angle : twoPI - angle) / arcSegmentCount;

    vertices.push(startVertex);
    for (var i = 1; i < arcSegmentCount; ++i) {
        var angle = startAngle + angle5 * i;
        var vertex = {
            x: center.x + Math.cos(angle) * radius,
            y: center.y + Math.sin(angle) * radius,
        };
        vertices.push(vertex);
    }
    vertices.push(endVertex);
}

function inwardEdgeNormal(edge)
{
    // Assuming that polygon vertices are in clockwise order
    var dx = edge.vertex2.x - edge.vertex1.x;
    var dy = edge.vertex2.y - edge.vertex1.y;
    var edgeLength = Math.sqrt(dx*dx + dy*dy);
    return {x: -dy/edgeLength, y: dx/edgeLength};
}

function outwardEdgeNormal(edge)
{
    var n = inwardEdgeNormal(edge);
    return {x: -n.x, y: -n.y};
}

// If the slope of line vertex1,vertex2 greater than the slope of vertex1,p then p is on the left side of vertex1,vertex2 and the return value is > 0.
// If p is colinear with vertex1,vertex2 then return 0, otherwise return a value < 0.

function leftSide(vertex1, vertex2, p)
{
    return ((p.x - vertex1.x) * (vertex2.y - vertex1.y)) - ((vertex2.x - vertex1.x) * (p.y - vertex1.y));
}

function isReflexVertex(vertices, vertexIndex)
{
    // Assuming that polygon vertices are in clockwise order
    var thisVertex = vertices[vertexIndex];
    var nextVertex = vertices[(vertexIndex + 1) % vertices.length];
    var prevVertex = vertices[(vertexIndex + vertices.length - 1) % vertices.length];
    if (leftSide(prevVertex, nextVertex, thisVertex) < 0)
        return true;  // TBD: return true if thisVertex is inside polygon when thisVertex isn't included

    return false;
}

function createPaddingPolygon(pts, padding)
{
    var edges = [];
    for (var i = 0; i < pts.length; i++) {
        pts[i].isReflex = isReflexVertex(pts, i);
        var edge = {
            vertex1: pts[i], 
            vertex2: pts[(i + 1) % pts.length], 
            index: i
        };
        edge.outwardNormal = outwardEdgeNormal(edge);
        edge.inwardNormal = inwardEdgeNormal(edge);
        edges.push(edge);
    }

    var offsetEdges = [];
    for (var i = 0; i < edges.length; i++) {
        var edge = edges[i];
        var dx = edge.inwardNormal.x * padding;
        var dy = edge.inwardNormal.y * padding;
        offsetEdges.push(createOffsetEdge(edge, dx, dy));
    }

    var vertices = [];
    for (var i = 0; i < offsetEdges.length; i++) {
        var thisEdge = offsetEdges[i];
        var prevEdge = offsetEdges[(i + offsetEdges.length - 1) % offsetEdges.length];
        var vertex = edgesIntersection(prevEdge, thisEdge);
        if (vertex)
            vertices.push(vertex);
        else {
            var arcCenter = edges[i].vertex1;
            appendArc(vertices, arcCenter, padding, prevEdge.vertex2, thisEdge.vertex1, true);
        }
    }
    return vertices;
}

},{}]},{},[1])
(1)
});