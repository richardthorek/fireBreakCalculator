/**
 * Search Control Component for MapboxGL JS
 * 
 * Provides collapsible search functionality for addresses, coordinates, and grid references
 * Designed to integrate with existing MapboxGL JS controls
 * 
 * @module SearchControl
 * @version 1.0.0
 */

import React, { useState, useRef, useEffect, useCallback } from 'react';
import { searchAddresses, debounce, type GeocodingResult } from '../utils/geocoding';
import { parseCoordinates, formatDecimalDegrees, type ParsedCoordinates } from '../utils/coordinateParser';
import { parseSixDigitGrid, findPossibleGridLocations, type GridMatch } from '../utils/gridReference';

export interface SearchControlProps {
  onLocationSelected: (location: { lat: number; lng: number; label: string }) => void;
  userLocation?: { lat: number; lng: number };
  className?: string;
}

type SearchMode = 'address' | 'coordinates' | 'grid';

interface SearchResult {
  id: string;
  label: string;
  sublabel?: string;
  lat: number;
  lng: number;
  type: 'address' | 'coordinate' | 'grid';
  confidence?: number;
}

export const SearchControl: React.FC<SearchControlProps> = ({
  onLocationSelected,
  userLocation,
  className = ''
}) => {
  const [isExpanded, setIsExpanded] = useState(false);
  const [searchMode, setSearchMode] = useState<SearchMode>('address');
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<SearchResult[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  
  const inputRef = useRef<HTMLInputElement>(null);
  const resultsRef = useRef<HTMLDivElement>(null);

  // Debounced search function
  const debouncedSearch = useCallback(
    debounce(async (searchQuery: string, mode: SearchMode) => {
      if (!searchQuery.trim()) {
        setResults([]);
        setIsLoading(false);
        return;
      }

      try {
        setError(null);
        let searchResults: SearchResult[] = [];

        switch (mode) {
          case 'address':
            searchResults = await performAddressSearch(searchQuery);
            break;
          case 'coordinates':
            searchResults = await performCoordinateSearch(searchQuery);
            break;
          case 'grid':
            searchResults = await performGridSearch(searchQuery);
            break;
        }

        setResults(searchResults);
      } catch (err) {
        console.error('Search failed:', err);
        setError(err instanceof Error ? err.message : 'Search failed');
        setResults([]);
      } finally {
        setIsLoading(false);
      }
    }, 300),
    [userLocation]
  );

  // Perform address search using Mapbox Geocoding API
  const performAddressSearch = async (query: string): Promise<SearchResult[]> => {
    const geocodingResults = await searchAddresses(query, {
      limit: 8,
      proximity: userLocation ? [userLocation.lng, userLocation.lat] : undefined,
      country: 'au', // Focus on Australia
      autocomplete: true
    });

    return geocodingResults.map((result: GeocodingResult, index: number) => ({
      id: `address-${result.id || index}`,
      label: result.place_name,
      sublabel: result.place_type.join(', '),
      lat: result.center[1],
      lng: result.center[0],
      type: 'address' as const,
      confidence: result.relevance
    }));
  };

  // Perform coordinate search
  const performCoordinateSearch = async (query: string): Promise<SearchResult[]> => {
    const parsed = parseCoordinates(query);
    if (!parsed) {
      return [];
    }

    return [{
      id: 'coordinate-1',
      label: formatDecimalDegrees(parsed.latitude, parsed.longitude),
      sublabel: `${parsed.format.toUpperCase()} format`,
      lat: parsed.latitude,
      lng: parsed.longitude,
      type: 'coordinate' as const,
      confidence: 1.0
    }];
  };

  // Perform grid reference search
  const performGridSearch = async (query: string): Promise<SearchResult[]> => {
    const parsed = parseSixDigitGrid(query);
    if (!parsed) {
      return [];
    }

    const gridMatches = findPossibleGridLocations(parsed, userLocation);
    
    return gridMatches.slice(0, 6).map((match: GridMatch, index: number) => ({
      id: `grid-${index}`,
      label: match.fullGrid,
      sublabel: match.distance 
        ? `${Math.round(match.distance)}km away`
        : `Confidence: ${Math.round(match.confidence * 100)}%`,
      lat: match.latitude,
      lng: match.longitude,
      type: 'grid' as const,
      confidence: match.confidence
    }));
  };

  // Handle search input changes
  const handleInputChange = (value: string) => {
    setQuery(value);
    setIsLoading(!!value.trim());
    debouncedSearch(value, searchMode);
  };

  // Handle mode change
  const handleModeChange = (mode: SearchMode) => {
    setSearchMode(mode);
    setQuery('');
    setResults([]);
    setError(null);
    if (inputRef.current) {
      inputRef.current.focus();
    }
  };

  // Handle result selection
  const handleResultSelect = (result: SearchResult) => {
    onLocationSelected({
      lat: result.lat,
      lng: result.lng,
      label: result.label
    });
    setIsExpanded(false);
    setQuery(result.label);
    setResults([]);
  };

  // Get placeholder text for current mode
  const getPlaceholder = () => {
    switch (searchMode) {
      case 'address':
        return 'Search for addresses...';
      case 'coordinates':
        return 'Enter coordinates (e.g., -33.8688, 151.2093)';
      case 'grid':
        return 'Enter 6-digit grid reference (e.g., 234567)';
      default:
        return 'Search...';
    }
  };

  // Click outside handler
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (resultsRef.current && !resultsRef.current.contains(event.target as Node)) {
        setResults([]);
      }
    };

    if (results.length > 0) {
      document.addEventListener('mousedown', handleClickOutside);
      return () => document.removeEventListener('mousedown', handleClickOutside);
    }
  }, [results]);

  return (
    <div className={`search-control ${className}`}>
      <div className="search-toggle">
        <button
          className={`search-toggle-btn ${isExpanded ? 'active' : ''}`}
          onClick={() => setIsExpanded(!isExpanded)}
          title={isExpanded ? 'Collapse search' : 'Expand search'}
          aria-label={isExpanded ? 'Collapse search panel' : 'Expand search panel'}
        >
          🔍
        </button>
      </div>

      {isExpanded && (
        <div className="search-panel">
          <div className="search-modes">
            <button
              className={`search-mode-btn ${searchMode === 'address' ? 'active' : ''}`}
              onClick={() => handleModeChange('address')}
              title="Search by address"
            >
              📍 Address
            </button>
            <button
              className={`search-mode-btn ${searchMode === 'coordinates' ? 'active' : ''}`}
              onClick={() => handleModeChange('coordinates')}
              title="Search by coordinates"
            >
              📐 Coordinates
            </button>
            <button
              className={`search-mode-btn ${searchMode === 'grid' ? 'active' : ''}`}
              onClick={() => handleModeChange('grid')}
              title="Search by grid reference"
            >
              🗺️ Grid Ref
            </button>
          </div>

          <div className="search-input-container">
            <input
              ref={inputRef}
              type="text"
              className="search-input"
              placeholder={getPlaceholder()}
              value={query}
              onChange={(e) => handleInputChange(e.target.value)}
              autoComplete="off"
            />
            {isLoading && (
              <div className="search-loading">⏳</div>
            )}
          </div>

          {error && (
            <div className="search-error">
              ⚠️ {error}
            </div>
          )}

          {results.length > 0 && (
            <div ref={resultsRef} className="search-results">
              {results.map((result) => (
                <button
                  key={result.id}
                  className="search-result-item"
                  onClick={() => handleResultSelect(result)}
                >
                  <div className="result-main">{result.label}</div>
                  {result.sublabel && (
                    <div className="result-sub">{result.sublabel}</div>
                  )}
                  {result.confidence !== undefined && result.confidence < 0.8 && (
                    <div className="result-confidence">
                      {Math.round(result.confidence * 100)}% match
                    </div>
                  )}
                </button>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
};